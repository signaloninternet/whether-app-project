import type { Bands } from "../../api/types";
import { RISK } from "../../lib/risk";
import { openOverlay, useStore } from "../../state/store";
import { Icon } from "../ui/Icon";
import styles from "./overlays.module.css";

const DECIMALS: Record<string, number> = { wind: 0, rain: 2, snow: 1 };

/** A band in the brief's notation: wind "25–34" / "≥ 55", rain "0.10–0.25" / "> 1.00". */
function bandText(b: Bands, condition: "wind" | "rain" | "snow", level: number): string {
  const d = DECIMALS[condition];
  const fmt = (v: number) => v.toFixed(d);
  const edges = [b.moderate, b.high, b.severe, b.no_travel];
  if (level === 0) return `< ${fmt(edges[0])}`;
  if (level === 4) return `${b.no_travel_inclusive ? "≥" : ">"} ${fmt(b.no_travel)}`;
  // Whole-mph wind bands read as "25–34"; fractional bands share their end points.
  const upper = d === 0 ? edges[level] - 1 : edges[level];
  return `${fmt(edges[level - 1])}–${fmt(upper)}`;
}

/** Thresholds, load rules and data sources, straight from the API. */
export function RulesSheet({ mobile }: { mobile: boolean }) {
  const rules = useStore((s) => s.rules);
  return (
    <>
      <div className={mobile ? styles.scrim : styles.catcher} onClick={() => openOverlay(null)} />
      <section className={mobile ? styles.sheet : styles.rules} aria-label="Risk rules">
        <header className={styles.themesHead}>
          <h2>Risk rules</h2>
          <button type="button" className={styles.closeDot} onClick={() => openOverlay(null)} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <p className={styles.rulesIntro}>
          Each checkpoint is rated by its worst condition at the hour the truck gets there. Routes are ranked by
          No Travel miles, then Severe, then High, then average risk, then travel time.
        </p>
        {rules ? (
          <>
            <table className={styles.table}>
              <thead>
                <tr><th>Level</th><th>Wind mph</th><th>Rain in/hr</th><th>Snow in/hr</th></tr>
              </thead>
              <tbody>
                {RISK.map((r) => (
                  <tr key={r.key}>
                    <td><span className={styles.levelDot} style={{ background: r.color }} />{r.label}</td>
                    <td>{bandText(rules.wind, "wind", r.level)}</td>
                    <td>{bandText(rules.rain, "rain", r.level)}</td>
                    <td>{bandText(rules.snow, "snow", r.level)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className={styles.rulesHeading}>Load rules</h3>
            <ul className={styles.rulesList}>
              <li>55 mph wind or more is No Travel for any load.</li>
              {rules.load_rules.map((r) => <li key={r.id}>{r.description}.</li>)}
            </ul>
            <h3 className={styles.rulesHeading}>How it's measured</h3>
            <ul className={styles.rulesList}>
              {rules.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </>
        ) : <p className={styles.rulesIntro}>Loading…</p>}
        <h3 className={styles.rulesHeading}>Data sources</h3>
        <ul className={styles.rulesList}>
          <li>Truck routing: Valhalla (FOSSGIS public server) on OpenStreetMap; OSRM finds long-haul corridors.</li>
          <li>Forecast: Open-Meteo hourly (wind 10 m, rain, showers, snowfall).</li>
          <li>Places: Photon by Komoot. Map: OpenFreeMap, Esri imagery, AWS terrain tiles.</li>
        </ul>
      </section>
    </>
  );
}
