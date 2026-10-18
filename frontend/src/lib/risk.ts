import type { Bands, HeatLayer, RiskKey, RiskLevel, Rules, Weather } from "../api/types";

export interface RiskMeta {
  level: RiskLevel;
  key: RiskKey;
  label: string;
  color: string;
  tint: string;
}

/** Status scale validated for CVD/normal-vision separation (see README → Colour). */
export const RISK: RiskMeta[] = [
  { level: 0, key: "low", label: "Low", color: "#237b4d", tint: "#e3f1e8" },
  { level: 1, key: "moderate", label: "Moderate", color: "#cbb120", tint: "#f7f1d2" },
  { level: 2, key: "high", label: "High", color: "#da5801", tint: "#fbe6d9" },
  { level: 3, key: "severe", label: "Severe", color: "#af0532", tint: "#f6dde2" },
  { level: 4, key: "no_travel", label: "No Travel", color: "#554185", tint: "#e8e3f2" },
];
export const UNKNOWN_COLOR = "#9aa0a6";

export function riskMeta(level: number | null | undefined): RiskMeta | null {
  return level == null || level < 0 ? null : RISK[level];
}

export function riskColor(level: number | null | undefined): string {
  return riskMeta(level)?.color ?? UNKNOWN_COLOR;
}

// --- heatmap colour ramps ----------------------------------------------------

export type RGBA = [number, number, number, number];

function hex(color: string, alpha: number): RGBA {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(alpha * 255)];
}

export interface Ramp {
  stops: { value: number; rgba: RGBA }[];
  unit: string;
  ticks: { value: number; label: string }[];
}

// Single-hue ramps (validated as ordinal ramps), one per condition. Their
// steps sit on the risk thresholds, so a colour change *is* a band change.
const STEPS: Record<Exclude<HeatLayer, "risk">, string[]> = {
  wind: ["#18a7a1", "#018d87", "#06726e", "#0e5c58", "#054744"],
  rain: ["#6eadfe", "#408dea", "#1d6ec9", "#0554a3", "#023e7d"],
  snow: ["#ba92fd", "#9c72de", "#7e53bc", "#65389f", "#4f1e85"],
};
const ALPHAS = [0.14, 0.44, 0.56, 0.66, 0.78];

function bandsFor(layer: Exclude<HeatLayer, "risk">, rules: Rules): Bands {
  return rules[layer];
}

export function valueRamp(layer: Exclude<HeatLayer, "risk">, rules: Rules): Ramp {
  const b = bandsFor(layer, rules);
  const steps = STEPS[layer];
  const fadeIn = b.moderate * (layer === "wind" ? 0.4 : 0.1);
  const values = [fadeIn, b.moderate, b.high, b.severe, b.no_travel];
  return {
    unit: b.unit,
    stops: [{ value: 0, rgba: hex(steps[0], 0) }, ...values.map((value, i) => ({ value, rgba: hex(steps[i], ALPHAS[i]) }))],
    ticks: [b.moderate, b.high, b.severe, b.no_travel].map((value) => ({ value, label: String(value) })),
  };
}

function copyInto(src: RGBA, out: RGBA): RGBA {
  out[0] = src[0];
  out[1] = src[1];
  out[2] = src[2];
  out[3] = src[3];
  return out;
}

/** Colour for a value (runs per pixel, so it writes into ``out`` instead of allocating). */
export function sampleRamp(ramp: Ramp, value: number, out: RGBA): RGBA {
  const { stops } = ramp;
  if (!(value > stops[0].value)) return copyInto(stops[0].rgba, out);
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i].value) {
      const a = stops[i - 1].rgba;
      const b = stops[i].rgba;
      const t = (value - stops[i - 1].value) / (stops[i].value - stops[i - 1].value);
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      out[3] = a[3] + (b[3] - a[3]) * t;
      return out;
    }
  }
  return copyInto(stops[stops.length - 1].rgba, out);
}

/** Risk heat: Low barely tints the corridor, everything above stands out. */
export const RISK_HEAT: RGBA[] = RISK.map((r, i) => hex(r.color, [0.12, 0.5, 0.58, 0.66, 0.76][i]));

// --- weather stickers ------------------------------------------------------------

/** Emoji sticker for a checkpoint: what a driver would notice first. */
export function weatherSticker(weather: Weather | null, windDriven: boolean): string {
  if (!weather) return "❔";
  const code = weather.code ?? 0;
  if (windDriven || (weather.wind_mph >= 25 && code < 51)) return "💨";
  if (code >= 95) return "⛈️";
  if ([56, 57, 66, 67].includes(code)) return "🧊";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86 || weather.snow_in_hr >= 0.1) return "🌨️";
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82) || weather.rain_in_hr >= 0.05) return "🌧️";
  if (code >= 51) return "🌦️";
  if (code === 45 || code === 48) return "🌫️";
  if (code === 3) return "☁️";
  if (code === 2) return weather.is_day ? "⛅" : "☁️";
  if (!weather.is_day) return "🌙";
  return code === 1 ? "🌤️" : "☀️";
}

export function describeWeather(w: Weather): string {
  const gust = w.gust_mph != null && w.gust_mph > w.wind_mph + 5 ? ` (gusts ${Math.round(w.gust_mph)})` : "";
  return `Wind ${Math.round(w.wind_mph)} mph${gust} · Rain ${w.rain_in_hr.toFixed(2)} · Snow ${w.snow_in_hr.toFixed(2)} in/hr`;
}
