import { useEffect, useState } from "react";
import { dismissToast, useStore } from "../../state/store";
import styles from "./overlays.module.css";

/** The reference's "On it" card: three stepping dots and a short label. */
export function LoadingCard() {
  const loading = useStore((s) => s.planStatus === "loading");
  const startedAt = useStore((s) => s.planStartedAt);
  const hadPlan = useStore((s) => s.plan !== null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [loading, startedAt]);

  if (!loading) return null;
  const step = seconds < 3 ? "Routing three truck options" : seconds < 7 ? "Sampling the forecast at each checkpoint" : "Scoring weather risk";
  return (
    <div className={`${styles.loadingScrim} ${hadPlan ? styles.loadingSoft : ""}`} role="status" aria-live="polite">
      <div className={styles.loadingCard}>
        <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        <strong>On it</strong>
        <span>{step}…</span>
        {seconds >= 8 ? <span className={styles.loadingHint}>Long trips are routed in several truck-model segments.</span> : null}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`${styles.toast} ${t.tone === "error" ? styles.toastError : ""}`}
          onClick={() => dismissToast(t.id)}>
          <strong>{t.title}</strong>
          {t.message ? <span>{t.message}</span> : null}
        </button>
      ))}
    </div>
  );
}
