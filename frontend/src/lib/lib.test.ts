import { describe, expect, it } from "vitest";
import type { Rules } from "../api/types";
import { decodePolyline, interpolateKnots, measure, pointAt } from "./geo";
import { type RGBA, sampleRamp, valueRamp, weatherSticker } from "./risk";
import { tripFromSearch, tripToSearch } from "./shareUrl";
import { formatDuration, fromLocalInput, toLocalInput } from "./time";

const RULES: Rules = {
  levels: [],
  wind: { unit: "mph", moderate: 25, high: 35, severe: 45, no_travel: 55, no_travel_inclusive: true },
  rain: { unit: "in/hr", moderate: 0.1, high: 0.25, severe: 0.5, no_travel: 1, no_travel_inclusive: false },
  snow: { unit: "in/hr", moderate: 0.5, high: 1, severe: 2, no_travel: 3, no_travel_inclusive: false },
  load_rules: [],
  notes: [],
};

describe("geo", () => {
  it("decodes Google's reference polyline as [lon, lat]", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("walks a line by distance", () => {
    const line = measure([[-100, 40], [-99, 40]]);
    const [lon, lat] = pointAt(line, line.length / 2);
    expect(lon).toBeCloseTo(-99.5, 3);
    expect(lat).toBeCloseTo(40, 6);
    expect(pointAt(line, -5)).toEqual([-100, 40]);
    expect(pointAt(line, line.length * 2)).toEqual([-99, 40]);
  });

  it("interpolates timeline knots, including parked stretches", () => {
    const knots: [number, number][] = [[0, 0], [3600, 60], [5400, 60], [9000, 120]];
    expect(interpolateKnots(knots, 1800)).toBe(30);
    expect(interpolateKnots(knots, 4500)).toBe(60); // on a break
    expect(interpolateKnots(knots, 7200)).toBe(90);
    expect(interpolateKnots(knots, 99_999)).toBe(120);
  });
});

describe("time", () => {
  it("round-trips wall-clock time in a zone, across a DST change", () => {
    for (const local of ["2026-07-04T08:00", "2026-11-01T01:30", "2026-11-02T08:00", "2026-03-08T03:30"]) {
      const epoch = fromLocalInput(local, "America/Chicago");
      expect(toLocalInput(epoch, "America/Chicago")).toBe(local);
    }
    expect(new Date(fromLocalInput("2026-07-04T08:00", "America/Chicago")).toISOString()).toBe("2026-07-04T13:00:00.000Z");
    expect(new Date(fromLocalInput("2026-12-04T08:00", "America/Chicago")).toISOString()).toBe("2026-12-04T14:00:00.000Z");
  });

  it("formats durations", () => {
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(16 * 3600 + 28 * 60)).toBe("16h 28m");
    expect(formatDuration(3600 + 5 * 60)).toBe("1h 05m");
  });
});

describe("risk ramps", () => {
  it("puts ramp steps on the risk thresholds", () => {
    const ramp = valueRamp("wind", RULES);
    expect(ramp.ticks.map((t) => t.value)).toEqual([25, 35, 45, 55]);
    const out: RGBA = [0, 0, 0, 0];
    expect(sampleRamp(ramp, 0, out)[3]).toBe(0); // calm recedes to transparent
    const at35 = [...sampleRamp(ramp, 35, out)];
    const at40 = [...sampleRamp(ramp, 40, out)];
    expect(at40[3]).toBeGreaterThan(at35[3]); // stronger wind, stronger tint
    expect(sampleRamp(ramp, 200, out)).toEqual(ramp.stops[ramp.stops.length - 1].rgba);
  });
});

describe("weather stickers", () => {
  const w = { wind_mph: 10, gust_mph: 14, rain_in_hr: 0, snow_in_hr: 0, temp_f: 50, code: 0, condition: "Clear", hour_utc: "" };
  it("shows what a driver notices first", () => {
    expect(weatherSticker(w, false, 13)).toBe("☀️");
    expect(weatherSticker(w, false, 2)).toBe("🌙");
    expect(weatherSticker({ ...w, code: 95 }, false, 13)).toBe("⛈️");
    expect(weatherSticker({ ...w, code: 73, snow_in_hr: 0.6 }, false, 13)).toBe("🌨️");
    expect(weatherSticker({ ...w, wind_mph: 40 }, true, 13)).toBe("💨");
    expect(weatherSticker(null, false, 13)).toBe("❔");
  });
});

describe("share links", () => {
  it("round-trips a trip through the URL", () => {
    const trip = {
      origin: { lat: 41.8781, lon: -87.6298, name: "Chicago", label: "Illinois, United States" },
      destination: { lat: 39.7392, lon: -104.9903, name: "Denver", label: "Colorado, United States" },
      departure: "2026-10-18T08:00",
      timezone: "America/Chicago",
      loadLb: 42_000,
      intervalMi: 10 as const,
      hos: true,
      routeId: "B",
    };
    expect(tripFromSearch(tripToSearch(trip))).toEqual(trip);
  });

  it("rejects broken links and clamps bad values", () => {
    expect(tripFromSearch("?from=nope&to=1,2")).toBeNull();
    const parsed = tripFromSearch("?from=1,2~A~&to=3,4~B~&w=999999&every=15&dep=tomorrow");
    expect(parsed).toMatchObject({ loadLb: 40_000, intervalMi: 25, departure: null });
  });
});
