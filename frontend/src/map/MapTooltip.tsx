import type { ReactNode } from "react";
import { RiskPill } from "../components/ui/controls";
import { riskMeta } from "../lib/risk";
import { formatDayTime, formatDuration } from "../lib/time";
import { useStore } from "../state/store";
import type { MapTarget } from "./controller";
import styles from "./map.module.css";

const UNITS = { wind: "mph", rain: "in/hr", snow: "in/hr" } as const;

/** Hover readout for routes, checkpoints and heat cells (values also live in the panel). */
export function MapTooltip({ target, x, y }: { target: MapTarget; x: number; y: number }) {
  const plan = useStore((s) => s.plan);
  if (!plan) return null;
  const tz = plan.inputs.timezone;
  let body: ReactNode = null;

  if (target.kind === "route") {
    const route = plan.routes.find((r) => r.id === target.routeId);
    if (!route) return null;
    const m = route.risk.miles_by_level;
    body = (
      <>
        <strong>Route {route.id} · {route.name}{route.recommended ? " · recommended" : ""}</strong>
        <span>{Math.round(route.distance_mi).toLocaleString()} mi · {formatDuration(route.travel_time_s)} · arrives {formatDayTime(route.arrival_utc, tz)}</span>
        <span>
          {m.no_travel > 0 ? `${Math.round(m.no_travel)} mi No Travel · ` : ""}{Math.round(m.severe)} mi Severe · {Math.round(m.high)} mi High · avg {route.risk.avg_risk.toFixed(2)}
        </span>
        <span className={styles.tipMuted}>Click to see its checkpoints</span>
      </>
    );
  } else if (target.kind === "checkpoint") {
    const cp = plan.routes.find((r) => r.id === target.routeId)?.checkpoints[target.index];
    if (!cp) return null;
    body = (
      <>
        <strong>Mile {Math.round(cp.mile).toLocaleString()} · {formatDayTime(cp.eta_utc, tz)}</strong>
        {cp.weather ? (
          <span>
            {cp.weather.condition}{cp.weather.temp_f != null ? ` · ${Math.round(cp.weather.temp_f)}°F` : ""} ·{" "}
            {Math.round(cp.weather.wind_mph)} mph wind · {cp.weather.rain_in_hr.toFixed(2)}″ rain · {cp.weather.snow_in_hr.toFixed(2)}″ snow
          </span>
        ) : <span>No forecast for this hour</span>}
        <RiskPill level={cp.risk?.level} suffix={cp.risk?.drivers.join(" + ") || undefined} />
      </>
    );
  } else {
    const value = target.layer === "risk"
      ? riskMeta(Math.round(target.value))?.label ?? "Unknown"
      : `${target.layer === "wind" ? Math.round(target.value) : target.value.toFixed(2)} ${UNITS[target.layer]}`;
    body = (
      <>
        <strong>{target.layer === "risk" ? "Weather risk" : target.layer[0].toUpperCase() + target.layer.slice(1)}: {value}</strong>
        <span className={styles.tipMuted}>Forecast at the slider time</span>
      </>
    );
  }

  return (
    <div className={styles.tooltip} style={{ transform: `translate(${x + 14}px, ${y + 14}px)` }} role="status">
      {body}
    </div>
  );
}
