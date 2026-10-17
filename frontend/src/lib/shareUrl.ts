import type { IntervalMi } from "../api/types";

/** A trip encoded in the URL, so a plan can be shared or reloaded. */
export interface SharedTrip {
  origin: { lat: number; lon: number; name: string; label: string };
  destination: { lat: number; lon: number; name: string; label: string };
  departure: string | null; // null = "leave soon" (a fresh default when opened)
  timezone: string | null;
  loadLb: number;
  intervalMi: IntervalMi;
  hos: boolean;
  routeId: string | null;
}

function encodePlace(p: SharedTrip["origin"]): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}~${p.name}~${p.label}`;
}

function decodePlace(raw: string | null): SharedTrip["origin"] | null {
  if (!raw) return null;
  const [coords, name = "", label = ""] = raw.split("~");
  const [lat, lon] = coords.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, name: name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, label };
}

export function tripToSearch(trip: SharedTrip): string {
  const params = new URLSearchParams();
  params.set("from", encodePlace(trip.origin));
  params.set("to", encodePlace(trip.destination));
  if (trip.departure) params.set("dep", trip.departure);
  if (trip.timezone) params.set("tz", trip.timezone);
  params.set("w", String(trip.loadLb));
  params.set("every", String(trip.intervalMi));
  if (trip.hos) params.set("hos", "1");
  if (trip.routeId) params.set("route", trip.routeId);
  return `?${params}`;
}

function validZone(zone: string | null): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null; // unknown zone in a hand-edited link: fall back to the origin's
  }
}

export function tripFromSearch(search: string): SharedTrip | null {
  const params = new URLSearchParams(search);
  const origin = decodePlace(params.get("from"));
  const destination = decodePlace(params.get("to"));
  if (!origin || !destination) return null;
  const load = params.has("w") ? Number(params.get("w")) : Number.NaN;
  const every = Number(params.get("every"));
  const departure = params.get("dep");
  return {
    origin,
    destination,
    departure: departure && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departure) ? departure : null,
    timezone: validZone(params.get("tz")),
    loadLb: Number.isFinite(load) && load >= 0 && load <= 80_000 ? load : 40_000,
    intervalMi: ([10, 25, 50] as const).includes(every as IntervalMi) ? (every as IntervalMi) : 25,
    hos: params.get("hos") === "1",
    routeId: params.get("route"),
  };
}
