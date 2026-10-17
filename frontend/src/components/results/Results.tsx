import type { Plan, Route } from "../../api/types";
import { formatDayTime, formatDuration, zoneAbbreviation } from "../../lib/time";
import { hoverRoute, selectRoute, useStore } from "../../state/store";
import { Sticker } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { RiskBar } from "./RiskBar";
import styles from "./results.module.css";

function tripTitle(plan: Plan): string {
  return `${plan.inputs.origin.label.split(",")[0]} → ${plan.inputs.destination.label.split(",")[0]}`;
}

function tripSubtitle(plan: Plan): string {
  const tz = plan.inputs.timezone;
  const leaves = `${formatDayTime(plan.departure_utc, tz)} ${zoneAbbreviation(tz, Date.parse(plan.departure_utc))}`;
  const load = `${plan.inputs.load_weight_lb.toLocaleString()} lb load`;
  return `Leaves ${leaves} · ${load} · checkpoints every ${plan.inputs.interval_mi} mi${plan.inputs.hos_breaks ? " · HOS breaks" : ""}`;
}

export function Results() {
  const plan = useStore((s) => s.plan)!;
  const selected = useStore((s) => s.selectedRouteId);
  const rec = plan.recommendation;
  const fastest = [...plan.routes].sort((a, b) => a.travel_time_s - b.travel_time_s)[0];

  return (
    <div>
      <h2 className={styles.title}>{tripTitle(plan)}</h2>
      <p className={styles.subtitle}>{tripSubtitle(plan)}</p>

      {plan.warnings.map((w) => (
        <div key={w} className={`${styles.notice} ${styles.noticeWarn}`} role="alert">
          <Icon name="warning" size={18} /> <span>{w}</span>
        </div>
      ))}

      <section className={styles.recommend} aria-label="Recommendation">
        <span className={styles.recommendLabel}><Icon name="sparkle" size={12} /> Recommended</span>
        <p className={styles.recommendHeadline}>{rec.headline}</p>
        <ul className={styles.reasons}>
          {rec.reasons.slice(-3).map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>{plan.routes.length} route options</h3>
          <p className={styles.sectionText}>Ranked by No Travel, Severe and High miles, then average risk, then time.</p>
        </div>
      </div>
      <div className={styles.cards}>
        {[...plan.routes].sort((a, b) => a.rank - b.rank).map((route) => (
          <RouteCard key={route.id} route={route} plan={plan} selected={route.id === selected}
            fastest={route.id === fastest.id} />
        ))}
      </div>

      {plan.notes.map((n) => (
        <div key={n} className={`${styles.notice} ${styles.noticeInfo}`}><Icon name="info" size={18} /> <span>{n}</span></div>
      ))}
      <p className={styles.footnote}>
        Routing: {plan.engine === "valhalla" ? "Valhalla truck model" : "OSRM"} on OpenStreetMap · Weather: Open-Meteo hourly
        forecast · Truck {plan.truck.gross_weight_lb.toLocaleString()} lb gross.
      </p>
    </div>
  );
}

function RouteCard({ route, plan, selected, fastest }: { route: Route; plan: Plan; selected: boolean; fastest: boolean }) {
  const m = route.risk.miles_by_level;
  return (
    <button type="button" className={styles.card} aria-current={selected}
      onClick={() => selectRoute(route.id)}
      onMouseEnter={() => hoverRoute(route.id)} onMouseLeave={() => hoverRoute(null)}
      onFocus={() => hoverRoute(route.id)} onBlur={() => hoverRoute(null)}>
      <Sticker emoji="🚚" size={30} badge={route.id} />
      <span className={styles.cardMain}>
        <span className={styles.cardTitle}>
          <span>{route.name}</span>
          {route.recommended ? <span className={`${styles.tag} ${styles.tagBlue}`}>Best</span> : null}
          {fastest && !route.recommended ? <span className={`${styles.tag} ${styles.tagGray}`}>Fastest</span> : null}
        </span>
        <span className={styles.cardMeta}>
          {Math.round(route.distance_mi).toLocaleString()} mi · {formatDuration(route.travel_time_s)} · arrives{" "}
          {formatDayTime(route.arrival_utc, plan.inputs.timezone)}
        </span>
      </span>
      <Icon name="chevronRight" className={styles.chevron} />
      <span className={styles.cardRisk}>
        <RiskBar risk={route.risk} />
        <span className={styles.cardStats}>
          {m.no_travel > 0 ? <span><b>{Math.round(m.no_travel)} mi</b> No Travel</span> : null}
          <span><b>{Math.round(m.severe)} mi</b> Severe</span>
          <span><b>{Math.round(m.high)} mi</b> High</span>
          <span>Avg risk <b>{route.risk.avg_risk.toFixed(2)}</b></span>
        </span>
      </span>
    </button>
  );
}
