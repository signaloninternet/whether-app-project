/** Geometry helpers. Coordinates are [lon, lat] like GeoJSON and MapLibre. */

export type LngLat = [number, number];

const R = 6_371_008.8;
export const METERS_PER_MILE = 1609.344;

export function decodePolyline(encoded: string, precision = 5): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

export function haversineM([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A decoded line with cumulative distances, for lookups by distance. */
export interface MeasuredLine {
  coords: LngLat[];
  cum: Float64Array;
  length: number;
}

export function measure(coords: LngLat[]): MeasuredLine {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversineM(coords[i - 1], coords[i]);
  return { coords, cum, length: cum[coords.length - 1] ?? 0 };
}

export function pointAt(line: MeasuredLine, meters: number): LngLat {
  const { coords, cum } = line;
  if (coords.length === 1 || meters <= 0) return coords[0];
  if (meters >= line.length) return coords[coords.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= meters) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const t = span > 0 ? (meters - cum[lo]) / span : 0;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

/** Piecewise-linear lookup in sorted [x, y] knots, clamped at the ends. */
export function interpolateKnots(knots: [number, number][], x: number): number {
  if (!knots.length) return 0;
  if (x <= knots[0][0]) return knots[0][1];
  const last = knots[knots.length - 1];
  if (x >= last[0]) return last[1];
  let lo = 0;
  let hi = knots.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = knots[lo];
  const [x1, y1] = knots[hi];
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

export type Bounds = [number, number, number, number]; // west, south, east, north

export function unionBounds(boxes: Bounds[]): Bounds {
  return boxes.reduce<Bounds>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}
