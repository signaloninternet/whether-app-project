import {
  type ExpressionSpecification,
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  type MapGeoJSONFeature,
  type PaddingOptions,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import type { Checkpoint, HeatLayer, Heatmap, Plan, Route } from "../api/types";
import { decodePolyline, haversineM, interpolateKnots, type LngLat, type MeasuredLine, measure, pointAt, unionBounds } from "../lib/geo";
import { RISK, riskColor, UNKNOWN_COLOR, weatherSticker } from "../lib/risk";
import { formatDayTime, formatDuration, localHour } from "../lib/time";
import { HeatRenderer } from "./heat";
import { addChrome, handleMissingImage, PILL_IMAGES, stickerId } from "./images";
import { ANCHOR_ROUTES, buildStyle, DEM_SOURCE } from "./style";
import { THEME_BY_ID, type ThemeId } from "./themes";

// MapLibre 6 ships its worker separately; let Vite fingerprint it.
setWorkerUrl(workerUrl);

export type MapTarget =
  | { kind: "route"; routeId: string }
  | { kind: "checkpoint"; routeId: string; index: number }
  | { kind: "heat"; layer: HeatLayer; value: number };

export interface MapCallbacks {
  onHover(target: MapTarget | null, point: { x: number; y: number } | null): void;
  onSelectRoute(routeId: string): void;
  onSelectCheckpoint(routeId: string, index: number): void;
}

interface PreparedRoute {
  route: Route;
  line: MeasuredLine;
  /** backend miles -> metres along the decoded (simplified) line */
  metersPerMile: number;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["routes", "risk", "pills", "checkpoints", "stops", "markers", "trucks"] as const;
const INTERACTIVE = ["cp-sticker", "cp-sticker-low", "cp-dot", "cp-dot-alt", "route-hit"];

const RISK_COLOR_EXPR: ExpressionSpecification = [
  "match", ["get", "level"],
  ...RISK.flatMap((r) => [r.level, r.color]),
  UNKNOWN_COLOR,
] as unknown as ExpressionSpecification;

export class MapController {
  readonly map: MapLibreMap;
  private heat: HeatRenderer;
  private theme: ThemeId;
  private plan: Plan | null = null;
  private routes = new Map<string, PreparedRoute>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private hour = 0;
  private heatLayer: HeatLayer = "risk";
  private heatVisible = true;
  private terrain = false;
  private padding: PaddingOptions = { top: 80, right: 80, bottom: 120, left: 80 };
  private hoverFrame = 0;
  private dimmed = false;

  constructor(container: HTMLElement, theme: ThemeId, private callbacks: MapCallbacks) {
    this.theme = theme;
    this.map = new MapLibreMap({
      container,
      style: buildStyle(THEME_BY_ID[theme]),
      center: [-96.5, 38.6],
      zoom: 3.6,
      minZoom: 2,
      maxPitch: 70,
      attributionControl: { compact: false },
      dragRotate: true,
      pitchWithRotate: true,
      fadeDuration: 150,
    });
    this.map.touchZoomRotate.disableRotation();
    this.heat = new HeatRenderer(this.map);
    this.map.setMissingStyleImageResolver((id) => handleMissingImage(this.map, id));
    this.map.on("style.load", () => this.installOverlays());
    this.map.on("mousemove", (e) => this.queueHover(e.point));
    this.map.on("mouseout", () => this.callbacks.onHover(null, null));
    this.map.on("click", (e) => this.handleClick(e.point));
  }

  destroy() {
    this.map.remove();
  }

  // --- public API ------------------------------------------------------------

  setTheme(theme: ThemeId) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.map.setStyle(buildStyle(THEME_BY_ID[theme]), { diff: false });
  }

  setPadding(padding: PaddingOptions) {
    this.padding = padding;
  }

  setPlan(plan: Plan | null) {
    this.plan = plan;
    this.routes.clear();
    for (const route of plan?.routes ?? []) {
      const line = measure(decodePolyline(route.polyline));
      this.routes.set(route.id, { route, line, metersPerMile: line.length / Math.max(0.1, route.distance_mi) });
    }
    this.selected = plan?.recommendation.route_id ?? null;
    this.hovered = null;
    this.pushData();
    this.applySelection();
    this.setHour(this.hour);
  }

  setDimmed(dimmed: boolean) {
    this.dimmed = dimmed;
    if (!this.map.isStyleLoaded()) return;
    const opacity = dimmed ? 0.35 : 1;
    for (const id of ["route-alt", "route-casing", "route-risk"]) {
      if (this.map.getLayer(id)) this.map.setPaintProperty(id, "line-opacity", opacity);
    }
    for (const id of ["cp-dot", "cp-dot-alt"]) {
      if (this.map.getLayer(id)) this.map.setPaintProperty(id, "circle-opacity", opacity);
    }
  }

  setSelection(selected: string | null, hovered: string | null) {
    if (selected === this.selected && hovered === this.hovered) return;
    this.selected = selected;
    this.hovered = hovered;
    this.applySelection();
  }

  /** ``hour`` = hours after departure. Heat frames start at the top of the departure hour. */
  setHour(hour: number) {
    this.hour = hour;
    this.heat.setHour(hour + this.departureOffsetHours());
    this.updateTrucks();
  }

  private departureOffsetHours(): number {
    if (!this.plan) return 0;
    const departure = Date.parse(this.plan.departure_utc);
    return (departure % 3_600_000) / 3_600_000;
  }

  setHeatmap(heatmap: Heatmap | null) {
    this.heat.setData(heatmap, this.plan?.rules ?? null, [...this.routes.values()].map((r) => r.line.coords));
    this.heat.setLayer(this.heatLayer);
    this.heat.setHour(this.hour + this.departureOffsetHours());
  }

  setHeatLayer(layer: HeatLayer) {
    this.heatLayer = layer;
    this.heat.setLayer(layer);
  }

  setHeatVisible(visible: boolean) {
    this.heatVisible = visible;
    this.heat.setVisible(visible);
  }

  setTerrain(enabled: boolean) {
    this.terrain = enabled;
    this.applyTerrain(true);
  }

  fitRoutes(animate = true) {
    if (!this.plan) return;
    const [w, s, e, n] = unionBounds(this.plan.routes.map((r) => r.bbox));
    this.map.fitBounds(new LngLatBounds([w, s], [e, n]), {
      padding: this.padding, maxZoom: 11, duration: animate ? 900 : 0,
    });
  }

  focusCheckpoint(routeId: string, index: number) {
    const cp = this.routes.get(routeId)?.route.checkpoints[index];
    if (!cp) return;
    this.map.flyTo({
      center: [cp.lon, cp.lat],
      zoom: Math.max(this.map.getZoom(), 8.5),
      padding: this.padding,
      duration: 900,
    });
  }

  zoomBy(delta: number) {
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 250 });
  }

  /** Screen position of a checkpoint, for anchoring the detail card. */
  checkpointLngLat(routeId: string, index: number): [number, number] | null {
    const cp = this.routes.get(routeId)?.route.checkpoints[index];
    return cp ? [cp.lon, cp.lat] : null;
  }

  // --- overlays ----------------------------------------------------------------

  private installOverlays() {
    const map = this.map;
    addChrome(map, THEME_BY_ID[this.theme].palette);
    for (const id of SOURCES) {
      if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY, tolerance: 0.25 });
    }
    const lineWidth = (stops: [number, number][]): ExpressionSpecification =>
      ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as ExpressionSpecification;

    map.addLayer({
      id: "route-hit", type: "line", source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#000", "line-opacity": 0, "line-width": 22 },
    }, ANCHOR_ROUTES);
    map.addLayer({
      id: "route-alt", type: "line", source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#5b6268", "line-width": lineWidth([[3, 2.6], [8, 3.6], [13, 5]]), "line-dasharray": [0, 2] },
    }, ANCHOR_ROUTES);
    map.addLayer({
      id: "route-casing", type: "line", source: "routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": lineWidth([[3, 6.5], [8, 9], [13, 13]]) },
    }, ANCHOR_ROUTES);
    map.addLayer({
      id: "route-risk", type: "line", source: "risk",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": RISK_COLOR_EXPR, "line-width": lineWidth([[3, 3.6], [8, 5.4], [13, 8]]) },
    }, ANCHOR_ROUTES);

    map.addLayer({
      id: "stops", type: "symbol", source: "stops", minzoom: 5,
      layout: { "icon-image": ["get", "sticker"], "icon-allow-overlap": false, "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true },
      paint: { "text-color": "#2b2b2b", "text-halo-color": "#fff", "text-halo-width": 1.4 },
    });
    // Alternatives show their checkpoints as small risk-coloured beads, so all routes compare at a glance.
    map.addLayer({
      id: "cp-dot-alt", type: "circle", source: "checkpoints",
      paint: {
        "circle-color": RISK_COLOR_EXPR,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 8, 3.2, 12, 4.5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-opacity": 0.9,
      },
    });
    map.addLayer({
      id: "cp-dot", type: "circle", source: "checkpoints",
      paint: {
        "circle-color": RISK_COLOR_EXPR,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.6, 8, 4.5, 12, 6.5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 10, 2],
      },
    });
    const stickerLayout = (labelFromZoom: number) => ({
      "icon-image": ["get", "sticker"] as ExpressionSpecification,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.82, 9, 1] as ExpressionSpecification,
      "icon-padding": 1,
      "symbol-sort-key": ["-", 0, ["get", "level"]] as ExpressionSpecification,
      "text-field": ["step", ["zoom"], "", labelFromZoom, ["get", "label"]] as ExpressionSpecification,
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-offset": [0, 1.55] as [number, number],
      "text-anchor": "top" as const,
      "text-optional": true,
    });
    map.addLayer({
      id: "cp-sticker-low", type: "symbol", source: "checkpoints", minzoom: 7.5,
      layout: stickerLayout(8.5),
      paint: { "text-color": "#2b2b2b", "text-halo-color": "#fff", "text-halo-width": 1.4 },
    });
    map.addLayer({
      id: "cp-sticker", type: "symbol", source: "checkpoints",
      // Risky checkpoints get their ETA earlier: those are the times a driver plans around.
      layout: stickerLayout(6),
      paint: { "text-color": "#2b2b2b", "text-halo-color": "#fff", "text-halo-width": 1.4 },
    });
    map.addLayer({
      id: "pills", type: "symbol", source: "pills",
      layout: {
        "icon-image": PILL_IMAGES.gray, "icon-text-fit": "both", "icon-text-fit-padding": [3, 7, 3, 7],
        "text-field": ["get", "text"], "text-font": ["Noto Sans Bold"], "text-size": 11.5,
        "icon-allow-overlap": true, "text-allow-overlap": true, "symbol-sort-key": ["get", "order"],
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "markers", type: "symbol", source: "markers",
      layout: {
        "icon-image": ["get", "sticker"], "icon-allow-overlap": true, "icon-anchor": "bottom",
        "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12.5,
        "text-anchor": "top", "text-offset": [0, 0.3], "text-max-width": 9, "text-optional": true,
      },
      paint: { "text-color": "#1f1f1f", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
    map.addLayer({
      id: "trucks", type: "symbol", source: "trucks",
      layout: {
        "icon-image": ["get", "sticker"], "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "order"],
      },
      paint: { "icon-opacity": ["case", ["get", "selected"], 1, 0.75] },
    });

    this.heat.install();
    this.pushData();
    this.applySelection();
    this.updateTrucks();
    this.applyTerrain(false);
    this.setDimmed(this.dimmed);
    this.heat.setVisible(this.heatVisible);
  }

  private source(id: (typeof SOURCES)[number]): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  /** Push the plan into the GeoJSON sources (no-op until the style has loaded). */
  private pushData() {
    const plan = this.plan;
    const routes = [...this.routes.values()];
    const tz = plan?.inputs.timezone ?? "UTC";

    this.source("routes")?.setData({
      type: "FeatureCollection",
      features: routes.map(({ route, line }) => ({
        type: "Feature", properties: { id: route.id }, geometry: { type: "LineString", coordinates: line.coords },
      })),
    });
    this.source("risk")?.setData({
      type: "FeatureCollection",
      features: routes.flatMap(({ route }) => route.segments.map((seg) => ({
        type: "Feature" as const,
        properties: { routeId: route.id, level: seg.level },
        geometry: { type: "LineString" as const, coordinates: decodePolyline(seg.polyline) },
      }))),
    });
    this.source("pills")?.setData({
      type: "FeatureCollection",
      features: routes.map(({ route }, i) => ({
        type: "Feature", properties: { id: route.id, order: i, text: `${route.id} · ${formatDuration(route.travel_time_s)}` },
        geometry: { type: "Point", coordinates: pillPosition(route.id, routes) },
      })),
    });
    this.source("checkpoints")?.setData({
      type: "FeatureCollection",
      features: routes.flatMap(({ route }) => route.checkpoints.map((cp) => checkpointFeature(route, cp, tz))),
    });
    this.source("stops")?.setData({
      type: "FeatureCollection",
      features: routes.flatMap(({ route }) => route.stops.map((stop) => ({
        type: "Feature" as const,
        properties: {
          routeId: route.id,
          sticker: stickerId(stop.kind === "rest" ? "🛏️" : "☕", null, 26),
          label: stop.kind === "rest" ? "10h rest" : "30m break",
        },
        geometry: { type: "Point" as const, coordinates: [stop.lon, stop.lat] },
      }))),
    });
    const first = plan?.routes[0];
    this.source("markers")?.setData(!plan || !first ? EMPTY : {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { sticker: stickerId("📦", null, 34), label: shortLabel(plan.inputs.origin.label) },
          geometry: { type: "Point", coordinates: [plan.inputs.origin.lon, plan.inputs.origin.lat] } },
        { type: "Feature", properties: { sticker: stickerId("🏁", null, 34), label: shortLabel(plan.inputs.destination.label) },
          geometry: { type: "Point", coordinates: [plan.inputs.destination.lon, plan.inputs.destination.lat] } },
      ],
    });
  }

  private applySelection() {
    const map = this.map;
    if (!map.getLayer("route-alt")) return;
    const sel = this.selected ?? "";
    const isSel: ExpressionSpecification = ["==", ["get", "id"], sel];
    const onSel: ExpressionSpecification = ["==", ["get", "routeId"], sel];
    map.setFilter("route-alt", ["!", isSel]);
    map.setFilter("route-casing", isSel);
    map.setFilter("route-risk", onSel);
    map.setFilter("cp-dot", onSel);
    map.setFilter("cp-dot-alt", ["!", onSel]);
    map.setFilter("cp-sticker", ["all", onSel, [">=", ["get", "level"], 1]]);
    map.setFilter("cp-sticker-low", ["all", onSel, ["<", ["get", "level"], 1]]);
    map.setFilter("stops", onSel);
    map.setPaintProperty("route-alt", "line-color",
      ["case", ["==", ["get", "id"], this.hovered ?? ""], "#2a2f33", "#5b6268"]);
    map.setPaintProperty("route-alt", "line-width",
      ["interpolate", ["linear"], ["zoom"], 3, ["case", ["==", ["get", "id"], this.hovered ?? ""], 3.6, 2.6],
        8, ["case", ["==", ["get", "id"], this.hovered ?? ""], 5, 3.6], 13, 5]);
    map.setLayoutProperty("pills", "icon-image",
      ["case", isSel, PILL_IMAGES.dark, ["==", ["get", "id"], this.hovered ?? ""], PILL_IMAGES.dark, PILL_IMAGES.gray]);
    map.setLayoutProperty("pills", "symbol-sort-key", ["case", isSel, 10, ["get", "order"]]);
    this.updateTrucks();
  }

  /** Each route's truck at the slider time; hidden while parked at the pickup or delivered. */
  private updateTrucks() {
    const source = this.source("trucks");
    if (!source) return;
    const elapsed = this.hour * 3600;
    const features = [...this.routes.values()]
      .filter(({ route }) => elapsed > 0 && elapsed < route.travel_time_s)
      .map(({ route, line, metersPerMile }, i) => {
        const mile = interpolateKnots(route.timeline, elapsed);
        const selected = route.id === this.selected;
        return {
          type: "Feature" as const,
          properties: { routeId: route.id, selected, order: selected ? 10 : i, sticker: stickerId("🚛", null, selected ? 34 : 24) },
          geometry: { type: "Point" as const, coordinates: pointAt(line, mile * metersPerMile) },
        };
      });
    source.setData({ type: "FeatureCollection", features });
  }

  private applyTerrain(animate: boolean) {
    const map = this.map;
    if (!map.getSource(DEM_SOURCE)) return;
    map.setTerrain(this.terrain ? { source: DEM_SOURCE, exaggeration: 1.35 } : null);
    if (animate) map.easeTo({ pitch: this.terrain ? 58 : 0, duration: 700 });
  }

  // --- interaction -------------------------------------------------------------

  private targetAt(point: { x: number; y: number }): MapTarget | null {
    const layers = INTERACTIVE.filter((id) => this.map.getLayer(id));
    const box: [[number, number], [number, number]] = [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]];
    const features: MapGeoJSONFeature[] = layers.length ? this.map.queryRenderedFeatures(box, { layers }) : [];
    const cp = features.find((f) => f.layer.id.startsWith("cp-"));
    if (cp) return { kind: "checkpoint", routeId: String(cp.properties.routeId), index: Number(cp.properties.index) };
    const route = features.find((f) => f.layer.id === "route-hit");
    if (route) return { kind: "route", routeId: String(route.properties.id) };
    const lngLat = this.map.unproject([point.x, point.y]);
    const heat = this.heat.valueAt(lngLat.lng, lngLat.lat);
    return heat ? { kind: "heat", ...heat } : null;
  }

  private queueHover(point: { x: number; y: number }) {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = requestAnimationFrame(() => {
      const target = this.targetAt(point);
      this.map.getCanvas().style.cursor = target && target.kind !== "heat" ? "pointer" : "";
      this.callbacks.onHover(target, target ? point : null);
    });
  }

  private handleClick(point: { x: number; y: number }) {
    const target = this.targetAt(point);
    if (target?.kind === "checkpoint") this.callbacks.onSelectCheckpoint(target.routeId, target.index);
    else if (target?.kind === "route") this.callbacks.onSelectRoute(target.routeId);
  }
}

function shortLabel(label: string): string {
  return label.split(",")[0];
}

function checkpointFeature(route: Route, cp: Checkpoint, tz: string): Feature {
  const level = cp.risk?.level ?? -1;
  const emoji = weatherSticker(cp.weather, cp.risk?.drivers.includes("wind") ?? false, localHour(cp.eta_utc, tz));
  return {
    type: "Feature",
    properties: {
      routeId: route.id,
      index: cp.index,
      level,
      color: riskColor(level),
      sticker: stickerId(emoji, level >= 1 ? level : null, level >= 2 ? 32 : 28),
      label: formatDayTime(cp.eta_utc, tz),
    },
    geometry: { type: "Point", coordinates: [cp.lon, cp.lat] },
  };
}

/** Put each route's pill where it is farthest from the other routes, so pills never stack. */
function pillPosition(id: string, routes: PreparedRoute[]): LngLat {
  const mine = routes.find((r) => r.route.id === id)!;
  const others = routes.filter((r) => r.route.id !== id);
  const samples = (r: PreparedRoute, n: number) =>
    Array.from({ length: n + 1 }, (_, k) => pointAt(r.line, (r.line.length * k) / n));
  const otherPoints = others.flatMap((r) => samples(r, 120));
  let best = pointAt(mine.line, mine.line.length / 2);
  let bestScore = -1;
  for (let k = 0; k <= 30; k++) {
    const p = pointAt(mine.line, mine.line.length * (0.25 + (0.5 * k) / 30));
    const score = otherPoints.length ? Math.min(...otherPoints.map((q) => haversineM(p, q))) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

