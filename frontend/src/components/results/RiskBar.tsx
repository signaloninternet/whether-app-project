import type { RouteRisk } from "../../api/types";
import { RISK, UNKNOWN_COLOR } from "../../lib/risk";
import styles from "./results.module.css";

/** Miles at each risk level, as one stacked bar (values are also listed beside it). */
export function RiskBar({ risk, large = false }: { risk: RouteRisk; large?: boolean }) {
  const parts = [
    ...RISK.map((r) => ({ key: r.key, label: r.label, color: r.color, miles: risk.miles_by_level[r.key] })),
    { key: "unknown", label: "No forecast", color: UNKNOWN_COLOR, miles: risk.unknown_miles },
  ].filter((p) => p.miles > 0.05);
  const total = parts.reduce((sum, p) => sum + p.miles, 0) || 1;
  const summary = parts.map((p) => `${p.label} ${Math.round(p.miles)} mi`).join(", ");
  return (
    <div className={`${styles.bar} ${large ? styles.large : ""}`} role="img" aria-label={`Risk by distance: ${summary}`}>
      {parts.map((p) => (
        <span key={p.key} className={styles.segment} title={`${p.label}: ${Math.round(p.miles).toLocaleString()} mi`}
          style={{ flexGrow: p.miles / total, flexBasis: 0, background: p.color }} />
      ))}
    </div>
  );
}
