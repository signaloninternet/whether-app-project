import { useEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint, Plan, Route } from "../../api/types";
import { RISK, riskColor, weatherSticker } from "../../lib/risk";
import { formatDayTime, formatDuration, localHour } from "../../lib/time";
import { focusCheckpoint, useStore } from "../../state/store";
import { RiskPill, Segmented, Sticker, ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { RiskBar } from "./RiskBar";
import styles from "./results.module.css";

type Filter = 0 | 1 | 2;
const PAGE = 60;

export function RouteDetail() {
  const plan = useStore((s) => s.plan)!;
  const routeId = useStore((s) => s.selectedRouteId);
  const focus = useStore((s) => s.focus);
  const route = plan.routes.find((r) => r.id === routeId) ?? plan.routes[0];
  const [filter, setFilter] = useState<Filter>(0);
  const [limit, setLimit] = useState(PAGE);
  const tz = plan.inputs.timezone;

  useEffect(() => {
    setFilter(0);
    setLimit(PAGE);
  }, [route.id]);

  const shown = useMemo(
    () => (filter === 0 ? route.checkpoints : route.checkpoints.filter((cp) => (cp.risk?.level ?? -1) >= filter)),
    [route, filter],
  );
  const counts = useMemo(() => ({
    moderate: route.checkpoints.filter((cp) => (cp.risk?.level ?? -1) >= 1).length,
    high: route.checkpoints.filter((cp) => (cp.risk?.level ?? -1) >= 2).length,
  }), [route]);

  // Reveal the focused checkpoint even if it is beyond the current page or filter.
  useEffect(() => {
    if (!focus || focus.routeId !== route.id) return;
    const level = route.checkpoints[focus.index]?.risk?.level ?? -1;
    if (level < filter) setFilter(0);
    if (focus.index >= limit) setLimit(focus.index + PAGE);
  }, [focus, route, filter, limit]);

  const total = route.distance_mi;
  return (
    <div>
      <h2 className={`${styles.title} ${styles.titleRow}`}>
        Route {route.id}
        {route.recommended ? <span className={`${styles.tag} ${styles.tagBlue}`}>Recommended</span> : null}
      </h2>
      <p className={styles.subtitle}>{route.name} · {strategyText(route)}</p>

      <div className={styles.stats}>
        <Stat label="Distance" value={`${Math.round(total).toLocaleString()} mi`} />
        <Stat label="Travel time" value={formatDuration(route.travel_time_s)}
          sub={route.travel_time_s > route.drive_time_s + 60 ? `${formatDuration(route.drive_time_s)} driving` : "no stops"} />
        <Stat label="Arrives" value={formatDayTime(route.arrival_utc, tz)} />
        <Stat label="Average risk" value={route.risk.avg_risk.toFixed(2)}
          sub={`worst: ${route.risk.max_level == null ? "unknown" : RISK[route.risk.max_level].label}`} />
      </div>

      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>Weather risk along the way</h3>
          <p className={styles.sectionText}>Each checkpoint covers the road halfway to its neighbours.</p>
        </div>
      </div>
      <RiskBar risk={route.risk} large />
      <div className={styles.legend}>
        {RISK.map((r) => {
          const miles = route.risk.miles_by_level[r.key];
          return (
            <div key={r.key} className={styles.legendRow}>
              <span className={styles.swatch} style={{ background: r.color }} />
              <span>{r.label}</span>
              <b>{Math.round(miles).toLocaleString()} mi</b>
              <span>{total ? Math.round((miles / total) * 100) : 0}%</span>
            </div>
          );
        })}
      </div>

      {route.stops.length ? (
        <>
          <div className={styles.sectionHead}>
            <div>
              <h3 className={styles.sectionTitle}>Hours-of-service stops</h3>
              <p className={styles.sectionText}>Included in every ETA below.</p>
            </div>
          </div>
          <div className={styles.list}>
            {route.stops.map((stop) => (
              <div key={stop.start_utc} className={styles.stop}>
                <Sticker emoji={stop.kind === "rest" ? "🛏️" : "☕"} size={22} />
                <span>
                  <strong>{stop.kind === "rest" ? "10 h rest" : "30 min break"}</strong> at mile {Math.round(stop.mile)} ·{" "}
                  {formatDayTime(stop.start_utc, tz)} – {formatDayTime(stop.end_utc, tz)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>{route.checkpoints.length} checkpoints</h3>
          <p className={styles.sectionText}>Every {plan.inputs.interval_mi} mi, at the forecast hour the truck arrives.</p>
        </div>
      </div>
      <div className={styles.filters}>
        <Segmented<Filter>
          label="Filter checkpoints"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setLimit(PAGE);
          }}
          options={[
            { value: 0, label: "All" },
            { value: 1, label: `Moderate+ ${counts.moderate}` },
            { value: 2, label: `High+ ${counts.high}` },
          ]}
        />
      </div>
      <div className={styles.list}>
        {shown.slice(0, limit).map((cp) => (
          <CheckpointRow key={cp.index} cp={cp} plan={plan} route={route}
            active={focus?.routeId === route.id && focus.index === cp.index} />
        ))}
        {!shown.length ? <p className={styles.emptyList}>No checkpoints at this level. Good news.</p> : null}
      </div>
      {shown.length > limit ? (
        <button type="button" className={`${ui.secondary} ${styles.more}`} onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      ) : null}
    </div>
  );
}

function strategyText(route: Route): string {
  if (route.engine === "osrm-car") return "road-network route re-timed for a truck";
  return route.strategy === "fastest" ? "truck router's best route" : route.strategy === "alternate" ? "truck router's alternative" : "alternative corridor";
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {sub ? <div className={styles.statSub}>{sub}</div> : null}
    </div>
  );
}

function CheckpointRow({ cp, plan, route, active }: { cp: Checkpoint; plan: Plan; route: Route; active: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const tz = plan.inputs.timezone;
  const level = cp.risk?.level ?? -1;
  const w = cp.weather;
  const isLast = cp.index === route.checkpoints.length - 1;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <button ref={ref} type="button" className={styles.checkpoint} aria-current={active}
      onClick={() => focusCheckpoint(route.id, cp.index)}>
      <span className={styles.cpSticker}>
        <Sticker emoji={weatherSticker(w, cp.risk?.drivers.includes("wind") ?? false, localHour(cp.eta_utc, tz))} size={26} />
        <span className={styles.cpBadge} style={{ background: riskColor(level) }}>{cp.index + 1}</span>
      </span>
      <span className={styles.cpBody}>
        <span className={styles.cpTitle}>
          {cp.index === 0 ? "Departure" : isLast ? "Arrival" : `Mile ${Math.round(cp.mile).toLocaleString()}`} ·{" "}
          {formatDayTime(cp.eta_utc, tz)}
        </span>
        <span className={styles.cpText}>
          {w ? (
            <>
              {w.condition} · {Math.round(w.wind_mph)} mph wind
              {w.gust_mph != null && w.gust_mph > w.wind_mph + 5 ? ` (gusts ${Math.round(w.gust_mph)})` : ""} ·{" "}
              {w.rain_in_hr.toFixed(2)}″/h rain · {w.snow_in_hr.toFixed(2)}″/h snow
              {w.temp_f != null ? ` · ${Math.round(w.temp_f)}°F` : ""}
            </>
          ) : "No forecast for this hour"}
        </span>
        <span className={styles.cpMeta}>
          <RiskPill level={cp.risk?.level} suffix={cp.risk?.drivers.length ? cp.risk.drivers.join(" + ") : undefined} />
          {cp.index > 0 ? <span className={styles.cpElapsed}>+{formatDuration(cp.elapsed_s)}</span> : null}
        </span>
        {cp.risk?.load_rule ? (
          <span className={styles.cpRule}><Icon name="weight" size={12} /> Load rule: {cp.risk.load_rule}</span>
        ) : null}
      </span>
    </button>
  );
}
