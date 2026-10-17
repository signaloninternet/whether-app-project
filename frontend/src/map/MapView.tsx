import { useEffect, useRef, useState } from "react";
import { focusCheckpoint, hoverRoute, selectRoute, useStore } from "../state/store";
import { MapController, type MapTarget } from "./controller";
import styles from "./map.module.css";
import { MapTooltip } from "./MapTooltip";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Owns the MapLibre instance. React never re-renders the map: store changes
 * are pushed into the imperative controller through subscriptions, so
 * dragging the forecast slider or hovering a card costs a source update, not
 * a component tree render.
 */
export function MapView({ insets, onReady }: { insets: Insets; onReady?: (c: MapController) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<MapController | null>(null);
  const [hover, setHover] = useState<{ target: MapTarget; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let c: MapController;
    try {
      c = new MapController(container.current!, useStore.getState().theme, {
        onHover: (target, point) => {
          if (target?.kind === "route") hoverRoute(target.routeId);
          else hoverRoute(null);
          setHover(target && point ? { target, ...point } : null);
        },
        onSelectRoute: (routeId) => selectRoute(routeId),
        onSelectCheckpoint: (routeId, index) => focusCheckpoint(routeId, index),
      });
    } catch (err) {
      // No WebGL (old device, locked-down browser): the panel still lists every route and checkpoint.
      console.error("Map unavailable", err);
      setFailed(true);
      return;
    }
    controller.current = c;
    onReady?.(c);

    // Coming back to the planner: rebuild the map from everything the store remembers.
    const s = useStore.getState();
    c.setPlan(s.plan);
    c.setSelection(s.selectedRouteId, s.hoveredRouteId);
    c.setHeatLayer(s.heatLayer);
    c.setHeatVisible(s.heatVisible);
    c.setHeatmap(s.heatmap);
    c.setHour(s.hour);
    if (s.terrain) c.setTerrain(true);
    if (s.plan) window.setTimeout(() => c.fitRoutes(false), 0);

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.theme !== prev.theme) c.setTheme(state.theme);
      if (state.plan !== prev.plan) {
        c.setPlan(state.plan);
        c.setHeatmap(null);
        // Let panels and the mobile sheet settle first so the fit uses the final padding.
        if (state.plan) window.setTimeout(() => c.fitRoutes(), 320);
      }
      if (state.heatmap !== prev.heatmap) c.setHeatmap(state.heatmap);
      if (state.selectedRouteId !== prev.selectedRouteId || state.hoveredRouteId !== prev.hoveredRouteId) {
        c.setSelection(state.selectedRouteId, state.hoveredRouteId);
      }
      if (state.hour !== prev.hour) c.setHour(state.hour);
      if (state.heatLayer !== prev.heatLayer) c.setHeatLayer(state.heatLayer);
      if (state.heatVisible !== prev.heatVisible) c.setHeatVisible(state.heatVisible);
      if (state.terrain !== prev.terrain) c.setTerrain(state.terrain);
      if (state.planStatus !== prev.planStatus) c.setDimmed(state.planStatus === "loading");
      if (state.focus && state.focus !== prev.focus) c.focusCheckpoint(state.focus.routeId, state.focus.index);
    });
    return () => {
      unsubscribe();
      c.destroy();
      controller.current = null;
    };
    // The controller lives as long as the page; later changes arrive via the store.
  }, []);

  useEffect(() => {
    controller.current?.setPadding({
      top: insets.top + 24,
      right: insets.right + 40,
      bottom: insets.bottom + 40,
      left: insets.left + 40,
    });
  }, [insets.top, insets.right, insets.bottom, insets.left]);

  return (
    <div className={styles.map}>
      <div ref={container} className={styles.canvas} />
      {failed ? (
        <p className={styles.unavailable} role="status">
          This browser can't draw the map (WebGL is unavailable). Routes, risk and every checkpoint are still in the panel.
        </p>
      ) : null}
      {hover ? <MapTooltip {...hover} /> : null}
    </div>
  );
}
