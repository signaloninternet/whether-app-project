import type { ReactNode } from "react";
import { riskMeta } from "../../lib/risk";
import styles from "./ui.module.css";

export { styles as ui };

export function Toggle({ checked, onChange, labels, title }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labels: [off: string, on: string];
  title?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={styles.toggle} title={title}
      onClick={() => onChange(!checked)}>
      <span>{checked ? labels[1] : labels[0]}</span>
      <span className={styles.knob} />
    </button>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.switch}
      onClick={() => onChange(!checked)}>
      <span className={styles.knob} />
      <span className={styles.label}>{checked ? "On" : "Off"}</span>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={styles.segment} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RiskPill({ level, suffix }: { level: number | null | undefined; suffix?: string }) {
  const meta = riskMeta(level);
  return (
    <span className={styles.riskPill} style={{ background: meta?.tint ?? "#ececec" }}>
      <span className={styles.riskDot} style={{ background: meta?.color ?? "#9aa0a6" }} />
      {meta?.label ?? "No forecast"}
      {suffix ? <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>· {suffix}</span> : null}
    </span>
  );
}

export function Sticker({ emoji, size = 34, badge }: { emoji: string; size?: number; badge?: ReactNode }) {
  return (
    <span style={{ position: "relative", display: "inline-grid", flex: "none" }}>
      <span className={styles.sticker} style={{ fontSize: size, width: size + 6, height: size + 6 }} aria-hidden="true">
        {emoji}
      </span>
      {badge != null ? <span className={styles.badge}>{badge}</span> : null}
    </span>
  );
}
