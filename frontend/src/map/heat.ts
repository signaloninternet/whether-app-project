import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import type { HeatLayer, Heatmap, Rules } from "../api/types";
import { type LngLat, mercatorY } from "../lib/geo";
import { type RGBA, type Ramp, RISK_HEAT, sampleRamp, valueRamp } from "../lib/risk";
import { ANCHOR_HEAT } from "./style";

const SOURCE = "heat";
const LAYER = "heat";

/**
 * Draws the corridor weather grid as one image over its bounds.
 *
 * The backend grid is coarse (a few dozen cells across) and regular in Web
 * Mercator. Each frame is upsampled bilinearly *in value space* and only then
 * coloured, so gradients follow the ramp instead of blending two colours.
 * Hours are cross-faded, which keeps the 0-48 h slider smooth between steps.
 * Wind is a value at each hour, so it blends between hours; rain, snow and
 * risk are totals *for* an hour, so they are drawn centred on that hour and
 * the hour containing the slider time always dominates (matching how
 * checkpoints are classified).
 * Cells outside the corridor take their nearest neighbour's value (so edges
 * don't fade towards zero), and the corridor's outline comes from the routes
 * themselves: a per-pixel distance field, so the edge is a smooth ribbon
 * rather than the coarse cells' staircase.
 */
export class HeatRenderer {
  private heat: Heatmap | null = null;
  private rules: Rules | null = null;
  private layer: HeatLayer = "risk";
  private visible = true;
  private hour = 0;
  private frames = new Map<HeatLayer, Float32Array[]>(); // per hour, full grid (dilated)
  private mask: Float32Array | null = null; // per output pixel, 0..1
  private inside: Uint8Array | null = null; // per grid cell: has forecast data
  private scale = 4;
  private image: ImageData | null = null;
  private ramps = new Map<HeatLayer, Ramp>();
  private pending = false;
  private styleReady = false;

  constructor(private map: MapLibreMap) {}

  /** The controller flips this around style (theme) changes; nothing is added mid-load. */
  setStyleReady(ready: boolean) {
    this.styleReady = ready;
  }

  setData(heat: Heatmap | null, rules: Rules | null, routes: LngLat[][] = []) {
    this.heat = heat;
    this.rules = rules;
    this.frames.clear();
    this.ramps.clear();
    this.mask = null;
    this.image = null;
    if (heat) {
      const { ncols, nrows } = heat.grid;
      this.inside = new Uint8Array(ncols * nrows);
      for (const idx of heat.grid.cells) this.inside[idx] = 1;
      this.scale = Math.max(2, Math.min(16, Math.round(360 / Math.max(ncols, nrows))));
      this.image = new ImageData(ncols * this.scale, nrows * this.scale);
      this.mask = corridorMask(heat, routes, this.image.width, this.image.height);
    }
    this.install();
  }

  setLayer(layer: HeatLayer) {
    this.layer = layer;
    this.render();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    if (this.map.getLayer(LAYER)) this.map.setLayoutProperty(LAYER, "visibility", visible ? "visible" : "none");
  }

  setHour(hour: number) {
    this.hour = hour;
    this.render();
  }

  /** Re-create the source and layer (after a style change). */
  install() {
    const map = this.map;
    if (!this.styleReady) return; // the controller calls install() again once the style has loaded
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    if (!this.heat) return;
    const [w, s, e, n] = this.heat.grid.bounds;
    map.addSource(SOURCE, { type: "image", coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    map.addLayer(
      {
        id: LAYER,
        type: "raster",
        source: SOURCE,
        layout: { visibility: this.visible ? "visible" : "none" },
        // The grid is regional; ease it off when zoomed into streets so the map stays legible.
        paint: {
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 6, 1, 9, 0.7, 12, 0.4],
        },
      },
      map.getLayer(ANCHOR_HEAT) ? ANCHOR_HEAT : undefined,
    );
    this.renderNow();
  }

  private render() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderNow();
    });
  }

  private framesFor(layer: HeatLayer): Float32Array[] {
    let frames = this.frames.get(layer);
    if (frames || !this.heat) return frames ?? [];
    const { ncols, nrows, cells } = this.heat.grid;
    const values = this.heat.layers[layer];
    frames = [];
    for (let h = 0; h <= this.heat.hours; h++) {
      const grid = new Float32Array(ncols * nrows).fill(Number.NaN);
      cells.forEach((idx, k) => {
        const v = values[h * cells.length + k];
        if (v != null && v >= 0) grid[idx] = v;
      });
      frames.push(dilate(grid, ncols, nrows));
    }
    this.frames.set(layer, frames);
    return frames;
  }

  private rampFor(layer: Exclude<HeatLayer, "risk">): Ramp {
    let ramp = this.ramps.get(layer);
    if (!ramp) {
      ramp = valueRamp(layer, this.rules!);
      this.ramps.set(layer, ramp);
    }
    return ramp;
  }

  private renderNow() {
    const heat = this.heat;
    const image = this.image;
    const source = this.map.getSource(SOURCE) as ImageSource | undefined;
    if (!heat || !image || !source || !this.mask || !this.rules) return;

    const frames = this.framesFor(this.layer);
    const { i0, i1, t } = blendFor(this.layer, this.hour, heat.hours);
    const a = frames[i0];
    const b = frames[i1];
    const { ncols, nrows } = heat.grid;
    const s = this.scale;
    const W = ncols * s;
    const H = nrows * s;
    const px = image.data;
    const mask = this.mask;
    const isRisk = this.layer === "risk";
    const ramp = isRisk ? null : this.rampFor(this.layer as Exclude<HeatLayer, "risk">);
    const rgba: RGBA = [0, 0, 0, 0];
    const c0: RGBA = [0, 0, 0, 0];
    const c1: RGBA = [0, 0, 0, 0];

    for (let y = 0; y < H; y++) {
      const gy = Math.min(nrows - 1, Math.max(0, (y + 0.5) / s - 0.5));
      const j0 = Math.floor(gy);
      const j1 = Math.min(nrows - 1, j0 + 1);
      const fy = gy - j0;
      for (let x = 0; x < W; x++) {
        const gx = Math.min(ncols - 1, Math.max(0, (x + 0.5) / s - 0.5));
        const i0 = Math.floor(gx);
        const i1 = Math.min(ncols - 1, i0 + 1);
        const fx = gx - i0;
        const o = (y * W + x) * 4;
        const m = mask[y * W + x];
        if (m < 0.01) {
          px[o + 3] = 0;
          continue;
        }
        const k00 = j0 * ncols + i0;
        const k01 = j0 * ncols + i1;
        const k10 = j1 * ncols + i0;
        const k11 = j1 * ncols + i1;
        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;
        if (isRisk) {
          // Categorical: blend the two neighbouring levels' colours, then the hours.
          riskAt(a, k00, k01, k10, k11, w00, w01, w10, w11, c0);
          riskAt(b, k00, k01, k10, k11, w00, w01, w10, w11, c1);
          for (let c = 0; c < 4; c++) rgba[c] = c0[c] + (c1[c] - c0[c]) * t;
        } else {
          const v0 = a[k00] * w00 + a[k01] * w01 + a[k10] * w10 + a[k11] * w11;
          const v1 = b[k00] * w00 + b[k01] * w01 + b[k10] * w10 + b[k11] * w11;
          sampleRamp(ramp!, v0 + (v1 - v0) * t, rgba);
        }
        px[o] = rgba[0];
        px[o + 1] = rgba[1];
        px[o + 2] = rgba[2];
        px[o + 3] = rgba[3] * m;
      }
    }
    source.updateImage({ image });
  }

  /** Value under the pointer for the hover readout (nearest cell, current hour). */
  valueAt(lng: number, lat: number): { layer: HeatLayer; value: number } | null {
    const heat = this.heat;
    if (!heat || !this.inside || !this.visible) return null;
    const [w, s, e, n] = heat.grid.bounds;
    const fx = (lng - w) / (e - w);
    const fy = (mercatorY(n) - mercatorY(lat)) / (mercatorY(n) - mercatorY(s));
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
    const idx = Math.floor(fy * heat.grid.nrows) * heat.grid.ncols + Math.floor(fx * heat.grid.ncols);
    const W = this.image!.width;
    const pixel = Math.floor(fy * this.image!.height) * W + Math.floor(fx * W);
    if (!this.inside[idx] || (this.mask?.[pixel] ?? 0) < 0.3) return null;
    const frames = this.framesFor(this.layer);
    const { i0, i1, t } = blendFor(this.layer, this.hour, heat.hours);
    const a = frames[i0]?.[idx];
    const b = frames[i1]?.[idx];
    if (a == null || Number.isNaN(a)) return null;
    // Wind reads the interpolated value; hourly totals read the hour containing the time.
    const value = this.layer === "wind" ? a + (b - a) * t : frames[hourIndex(this.hour, heat.hours)][idx];
    return Number.isNaN(value) ? null : { layer: this.layer, value };
  }
}

function hourIndex(hour: number, hours: number): number {
  return Math.max(0, Math.min(hours, Math.floor(hour)));
}

/** Which two frames to blend at ``hour`` (frames are hourly from the start of the departure hour). */
export function blendFor(layer: HeatLayer, hour: number, hours: number): { i0: number; i1: number; t: number } {
  const pos = Math.max(0, Math.min(hours, layer === "wind" ? hour : hour - 0.5));
  const i0 = Math.min(hours, Math.floor(pos));
  const i1 = Math.min(hours, i0 + 1);
  return { i0, i1, t: i1 === i0 ? 0 : pos - i0 };
}

function addRisk(level: number, weight: number, out: RGBA) {
  const color = RISK_HEAT[Number.isNaN(level) ? 0 : Math.max(0, Math.min(4, Math.round(level)))];
  out[0] += color[0] * weight;
  out[1] += color[1] * weight;
  out[2] += color[2] * weight;
  out[3] += color[3] * weight;
}

/** Bilinear blend of the four neighbouring cells' risk colours (allocation-free: runs per pixel). */
function riskAt(
  f: Float32Array, k00: number, k01: number, k10: number, k11: number,
  w00: number, w01: number, w10: number, w11: number, out: RGBA,
) {
  out[0] = out[1] = out[2] = out[3] = 0;
  addRisk(f[k00], w00, out);
  addRisk(f[k01], w01, out);
  addRisk(f[k10], w10, out);
  addRisk(f[k11], w11, out);
}

/** Fill unknown cells with the mean of known neighbours, repeatedly, so edges interpolate cleanly. */
function dilate(grid: Float32Array, ncols: number, nrows: number): Float32Array {
  const out = Float32Array.from(grid);
  for (let pass = 0; pass < 3; pass++) {
    const prev = Float32Array.from(out);
    for (let j = 0; j < nrows; j++) {
      for (let i = 0; i < ncols; i++) {
        const k = j * ncols + i;
        if (!Number.isNaN(prev[k])) continue;
        let sum = 0;
        let count = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj < 0 || ii < 0 || jj >= nrows || ii >= ncols) continue;
            const v = prev[jj * ncols + ii];
            if (!Number.isNaN(v)) {
              sum += v;
              count++;
            }
          }
        }
        if (count) out[k] = sum / count;
      }
    }
  }
  for (let k = 0; k < out.length; k++) if (Number.isNaN(out[k])) out[k] = 0;
  return out;
}

/** Two-pass chamfer (3-4) distance transform, in place. Units: 3 per pixel. */
function chamfer(dist: Float32Array, W: number, H: number) {
  const relax = (k: number, other: number, cost: number) => {
    if (dist[other] + cost < dist[k]) dist[k] = dist[other] + cost;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (x > 0) relax(k, k - 1, 3);
      if (y > 0) {
        relax(k, k - W, 3);
        if (x > 0) relax(k, k - W - 1, 4);
        if (x < W - 1) relax(k, k - W + 1, 4);
      }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const k = y * W + x;
      if (x < W - 1) relax(k, k + 1, 3);
      if (y < H - 1) {
        relax(k, k + W, 3);
        if (x < W - 1) relax(k, k + W + 1, 4);
        if (x > 0) relax(k, k + W - 1, 4);
      }
    }
  }
}

/**
 * Soft corridor outline, matching the backend's corridor: a buffer of
 * ``radius_km`` around the routes, morphologically closed by ``closing_km`` so
 * narrow gaps between alternatives fill in. Rasterise the routes, take a
 * distance field, grow it by the closing radius, then measure how far each
 * pixel sits inside the grown shape. Computed once per heatmap.
 */
function corridorMask(heat: Heatmap, routes: LngLat[][], W: number, H: number): Float32Array {
  const [west, south, east, north] = heat.grid.bounds;
  const yN = mercatorY(north);
  const yS = mercatorY(south);
  const toPx = ([lon, lat]: LngLat): [number, number] => [
    ((lon - west) / (east - west)) * W,
    ((yN - mercatorY(lat)) / (yN - yS)) * H,
  ];
  const INF = 1e9;
  const toRoute = new Float32Array(W * H).fill(INF);
  for (const line of routes) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = toPx(line[i - 1]);
      const [x1, y1] = toPx(line[i]);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let k = 0; k <= steps; k++) {
        const x = Math.floor(x0 + ((x1 - x0) * k) / steps);
        const y = Math.floor(y0 + ((y1 - y0) * k) / steps);
        if (x >= 0 && y >= 0 && x < W && y < H) toRoute[y * W + x] = 0;
      }
    }
  }
  chamfer(toRoute, W, H);

  const unitsPerKm = (W / heat.grid.ncols / heat.grid.cell_km) * 3; // chamfer units are 3 per pixel
  const radius = heat.grid.radius_km * unitsPerKm;
  const closing = (heat.grid.closing_km ?? 0) * unitsPerKm;
  const toOutside = new Float32Array(W * H);
  for (let k = 0; k < toOutside.length; k++) toOutside[k] = toRoute[k] > radius + closing ? 0 : INF;
  chamfer(toOutside, W, H);

  // depth = how far inside the closed corridor a pixel is; fade over the outer fifth of the radius.
  const fade = radius * 0.2;
  const mask = new Float32Array(W * H);
  for (let k = 0; k < mask.length; k++) {
    const depth = Math.max(toOutside[k] - closing, radius - toRoute[k]);
    mask[k] = depth >= fade ? 1 : depth <= 0 ? 0 : depth / fade;
  }
  return mask;
}
