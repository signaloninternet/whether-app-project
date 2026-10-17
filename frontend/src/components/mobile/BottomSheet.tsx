import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import styles from "./mobile.module.css";

export type Snap = "peek" | "half" | "full";
const FRACTION: Record<Snap, number> = { peek: 0.3, half: 0.56, full: 0.92 };

/**
 * Mobile container for the panel content: a sheet with three snap heights,
 * dragged by its handle/header. Only the height changes, so the content keeps
 * its own scroll position.
 */
export function BottomSheet({ header, footer, children, snap, onSnap, onHeight }: {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  snap: Snap;
  onSnap: (snap: Snap) => void;
  onHeight: (px: number) => void;
}) {
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; height: number; t: number } | null>(null);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const snapped = Math.round(viewport * FRACTION[snap]);
  const height = drag ?? snapped;

  useEffect(() => {
    onHeight(snapped);
  }, [snapped, onHeight]);

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    start.current = { y: e.clientY, height, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!start.current) return;
    const next = start.current.height + (start.current.y - e.clientY);
    setDrag(Math.max(viewport * 0.18, Math.min(viewport * 0.95, next)));
  };

  const finish = useCallback((e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || drag == null) {
      setDrag(null);
      return;
    }
    const velocity = (s.y - e.clientY) / Math.max(1, performance.now() - s.t); // px/ms, + = up
    const options = (Object.keys(FRACTION) as Snap[]).map((k) => ({ k, h: viewport * FRACTION[k] }));
    let target = options.reduce((best, o) => (Math.abs(o.h - drag) < Math.abs(best.h - drag) ? o : best)).k;
    if (Math.abs(velocity) > 0.6) {
      const order: Snap[] = ["peek", "half", "full"];
      const i = order.indexOf(snap);
      target = order[Math.max(0, Math.min(2, i + (velocity > 0 ? 1 : -1)))];
    }
    setDrag(null);
    onSnap(target);
  }, [drag, onSnap, snap, viewport]);

  return (
    <section className={styles.sheet} style={{ height, transition: drag == null ? undefined : "none" }} aria-label="Trip planner">
      <div className={styles.grab} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={finish} onPointerCancel={finish}>
        <button type="button" className={styles.handle} aria-label={snap === "full" ? "Collapse panel" : "Expand panel"}
          onClick={() => onSnap(snap === "full" ? "half" : "full")} />
        {header}
      </div>
      <div className={styles.sheetBody} id="panel-body">{children}</div>
      {footer}
    </section>
  );
}
