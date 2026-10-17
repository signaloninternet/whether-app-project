import { type CSSProperties, useEffect, useMemo } from "react";
import type { HeatLayer, Plan, Rules } from "../../api/types";
import { RISK, valueRamp } from "../../lib/risk";
import { formatDayTime, formatHour, zoneAbbreviation } from "../../lib/time";
import { loadHeatmap, openOverlay, setHeatLayer, setHour, setPlaying, toggleHeat, useStore } from "../../state/store";
import { Segmented, ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import styles from "./tray.module.css";

const HOURS = 48;
const PLAY_SPEED = 3; // forecast hours per second
const LAYERS: { value: HeatLayer; label: string }[] = [
  { value: "risk", label: "Risk" },
  { value: "wind", label: "Wind" },
  { value: "rain", label: "Rain" },
  { value: "snow", label: "Snow" },
];

export function ForecastTray({ compact = false }: { compact?: boolean }) {
  const plan = useStore((s) => s.plan);
  const hour = useStore((s) => s.hour);
  const playing = useStore((s) => s.playing);
  const layer = useStore((s) => s.heatLayer);
  const visible = useStore((s) => s.heatVisible);
  const heatStatus = useStore((s) => s.heatStatus);
  const heatNote = useStore((s) => s.heatNote);
  usePlayback(playing);
  if (!plan) return null;

  const tz = plan.inputs.timezone;
  const departure = Date.parse(plan.departure_utc);
  const at = departure + hour * 3_600_000;

  return (
    <section className={`${styles.tray} ${compact ? styles.compact : ""}`} aria-label="Forecast timeline">
      <div className={styles.top}>
        <button type="button" className={styles.play} onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause forecast" : "Play forecast"}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <div className={styles.time}>
          <strong className="tabular">{formatDayTime(at, tz)} <span>{zoneAbbreviation(tz, at)}</span></strong>
          <span>+{Math.round(hour)} h · {heatNote ?? statusText(heatStatus)}</span>
        </div>
        <div className={styles.controls}>
          {compact ? (
            // Phones: the OS picker beats four tiny chips.
            <select className={styles.layerSelect} value={layer} aria-label="Heatmap layer"
              onChange={(e) => setHeatLayer(e.target.value as HeatLayer)}>
              {LAYERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          ) : (
            <Segmented<HeatLayer> label="Heatmap layer" value={layer} onChange={setHeatLayer} options={LAYERS} />
          )}
          <button type="button" className={ui.iconButton} aria-pressed={!visible}
            aria-label={visible ? "Hide heatmap" : "Show heatmap"} title={visible ? "Hide heatmap" : "Show heatmap"}
            onClick={toggleHeat}>
            <Icon name={visible ? "eye" : "eyeOff"} size={18} />
          </button>
          {compact ? null : (
            <button type="button" className={ui.iconButton} aria-label="Map view" title="Map view"
              onClick={() => openOverlay("themes")}>
              <Icon name="palette" size={18} />
            </button>
          )}
        </div>
      </div>
      <Timeline plan={plan} hour={hour} departure={departure} />
      {heatStatus === "error" ? (
        <p className={styles.error}>
          The forecast grid didn't load. <button type="button" onClick={() => loadHeatmap()}>Retry</button>
        </p>
      ) : (
        <Legend layer={layer} rules={plan.rules} />
      )}
    </section>
  );
}

function statusText(status: string): string {
  if (status === "loading") return "loading forecast grid…";
  if (status === "error") return "forecast grid unavailable";
  return "forecast along the corridor";
}

/** Route letters at their arrival time; arrivals within three hours share one flag. */
function arrivalFlags(plan: Plan, departure: number) {
  const flags: { h: number; ids: string[]; best: boolean }[] = [];
  const arrivals = plan.routes
    .map((r) => ({ id: r.id, h: (Date.parse(r.arrival_utc) - departure) / 3_600_000, best: r.recommended }))
    .filter((a) => a.h <= HOURS)
    .sort((a, b) => a.h - b.h);
  for (const a of arrivals) {
    const last = flags[flags.length - 1];
    if (last && a.h - last.h < 3) {
      last.ids.push(a.id);
      last.best ||= a.best;
    } else {
      flags.push({ h: a.h, ids: [a.id], best: a.best });
    }
  }
  return flags;
}

function Timeline({ plan, hour, departure }: { plan: Plan; hour: number; departure: number }) {
  const tz = plan.inputs.timezone;
  const ticks = [0, 12, 24, 36, 48];
  return (
    <div className={styles.timeline}>
      <div className={styles.flags} aria-hidden="true">
        {arrivalFlags(plan, departure).map((f) => (
          <span key={f.ids.join()} className={`${styles.arrival} ${f.best ? styles.arrivalBest : ""}`}
            style={{ left: `${(f.h / HOURS) * 100}%` }} title={`Route ${f.ids.join(", ")} arrive${f.ids.length > 1 ? "" : "s"}`}>
            {f.ids.join(" · ")}
          </span>
        ))}
      </div>
      <div className={styles.track}>
        <input type="range" min={0} max={HOURS} step={0.25} value={hour} className={styles.range}
          aria-label="Hours after departure" aria-valuetext={`${Math.round(hour)} hours after departure`}
          style={{ "--fill": `${(hour / HOURS) * 100}%` } as CSSProperties}
          onChange={(e) => {
            setPlaying(false);
            setHour(Number(e.target.value));
          }} />
      </div>
      <div className={styles.ticks} aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / HOURS) * 100}%` }}>
            {t === 0 ? "Depart" : formatHour(departure + t * 3_600_000, tz)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend({ layer, rules }: { layer: HeatLayer; rules: Rules }) {
  const ramp = useMemo(() => (layer === "risk" ? null : valueRamp(layer, rules)), [layer, rules]);
  if (!ramp) {
    return (
      <div className={styles.legend} aria-label="Risk legend">
        {RISK.map((r) => (
          <span key={r.key} className={styles.key}>
            <span className={styles.swatch} style={{ background: r.color }} /> {r.label}
          </span>
        ))}
      </div>
    );
  }
  const max = ramp.stops[ramp.stops.length - 1].value;
  const gradient = ramp.stops
    .map((s) => `rgba(${s.rgba[0]},${s.rgba[1]},${s.rgba[2]},${Math.max(0.15, s.rgba[3] / 255)}) ${(s.value / max) * 100}%`)
    .join(", ");
  return (
    <div className={styles.scale} aria-label={`${layer} scale in ${ramp.unit}`}>
      <span className={styles.scaleBar} style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      <span className={styles.scaleTicks}>
        <span style={{ left: 0 }}>0</span>
        {ramp.ticks.map((t, i) => (
          <span key={t.value} style={{ left: `${(t.value / max) * 100}%` }}>
            {t.label}{i === ramp.ticks.length - 1 ? ` ${ramp.unit}` : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

/** Advance the slider while playing (rAF, so it stays smooth and pauses in background tabs). */
function usePlayback(playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const hour = useStore.getState().hour + ((now - last) / 1000) * PLAY_SPEED;
      last = now;
      if (hour >= HOURS) {
        setHour(HOURS);
        setPlaying(false);
        return;
      }
      setHour(hour);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
