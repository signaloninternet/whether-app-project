import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BottomSheet, type Snap } from "../components/mobile/BottomSheet";
import mobile from "../components/mobile/mobile.module.css";
import { LoadingCard, Toasts } from "../components/overlays/Feedback";
import { RulesSheet } from "../components/overlays/RulesSheet";
import { ShareModal } from "../components/overlays/ShareModal";
import { ThemePicker } from "../components/overlays/ThemePicker";
import { Panel } from "../components/panel/Panel";
import { PanelContent, PanelFooter } from "../components/panel/PanelContent";
import { PanelHeader } from "../components/panel/PanelHeader";
import { PlaceSearch } from "../components/plan/PlaceSearch";
import { ForecastTray } from "../components/tray/ForecastTray";
import { Icon } from "../components/ui/Icon";
import { tripFromSearch } from "../lib/shareUrl";
import type { MapController } from "../map/controller";
import { MapView } from "../map/MapView";
import { THEME_BY_ID } from "../map/themes";
import { applySharedTrip, loadRules, openOverlay, runPlan, useStore } from "../state/store";
import styles from "./planner.module.css";

const MOBILE_QUERY = "(max-width: 899px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function Planner() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const location = useLocation();
  const [controller, setController] = useState<MapController | null>(null);
  const overlay = useStore((s) => s.overlay);
  const search = useStore((s) => s.search);
  const plan = useStore((s) => s.plan);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const [snap, setSnap] = useState<Snap>("half");
  const [sheetHeight, setSheetHeight] = useState(0);

  // Shared links (?from=…&to=…) and landing-page shortcuts plan straight away.
  useEffect(() => {
    loadRules();
    const trip = tripFromSearch(location.search);
    if (trip) {
      applySharedTrip(trip);
      runPlan(trip.routeId);
    }
    // Only on arrival; later URL changes are written by the app itself.
  }, []);

  // Phones: results start low so the map shows; forms and details need room.
  useEffect(() => {
    if (!isMobile) return;
    setSnap(view === "results" ? "peek" : "half");
  }, [view, plan, isMobile]);

  const onSheetHeight = useCallback((h: number) => setSheetHeight(h), []);
  const insets = useMemo(
    () => (isMobile
      ? { top: 60, right: 0, bottom: sheetHeight + (plan ? 120 : 0), left: 0 }
      : { top: 0, right: 60, bottom: plan ? 150 : 0, left: 404 + 36 }),
    [isMobile, sheetHeight, plan],
  );

  const accent = THEME_BY_ID[theme].palette.accent;
  return (
    <div className={styles.page} style={{ "--accent": accent } as CSSProperties}>
      <MapView insets={insets} onReady={setController} />

      {isMobile ? (
        <>
          <div className={mobile.topBar}>
            <Link to="/" className={mobile.logo} aria-label="Routecast home">R</Link>
            <span className={mobile.spacer} />
            <button type="button" className={mobile.roundButton} aria-label="Map view" onClick={() => openOverlay("themes")}>
              <Icon name="palette" size={19} />
            </button>
            <button type="button" className={mobile.roundButton} aria-label="Fit routes" disabled={!plan}
              onClick={() => controller?.fitRoutes()}>
              <Icon name="compass" size={19} />
            </button>
            <button type="button" className={mobile.roundButton} aria-label="Share" disabled={!plan}
              onClick={() => openOverlay("share")}>
              <Icon name="share" size={19} />
            </button>
          </div>
          {plan && snap !== "full" ? (
            <div className={mobile.trayDock} style={{ bottom: sheetHeight + 8 }}>
              <ForecastTray compact />
            </div>
          ) : null}
          <BottomSheet header={<PanelHeader />} footer={<PanelFooter />} snap={snap} onSnap={setSnap} onHeight={onSheetHeight}>
            <PanelContent />
          </BottomSheet>
        </>
      ) : (
        <>
          <Panel controller={controller} />
          <div className={styles.topRight}>
            <button type="button" className={styles.share} disabled={!plan} onClick={() => openOverlay("share")}>
              Share
            </button>
          </div>
          <div className={styles.mapControls}>
            <div className={styles.zoom}>
              <button type="button" aria-label="Zoom in" onClick={() => controller?.zoomBy(1)}><Icon name="plus" size={18} /></button>
              <button type="button" aria-label="Zoom out" onClick={() => controller?.zoomBy(-1)}><Icon name="minus" size={18} /></button>
            </div>
            <button type="button" className={styles.help} aria-label="Risk rules and data sources" title="Risk rules & data"
              onClick={() => openOverlay(overlay === "rules" ? null : "rules")}>
              <Icon name="book" size={20} />
            </button>
          </div>
          <ForecastTray />
        </>
      )}

      <LoadingCard />
      {search ? <PlaceSearch key={search} mobile={isMobile} /> : null}
      {overlay === "themes" ? <ThemePicker mobile={isMobile} /> : null}
      {overlay === "share" ? <ShareModal /> : null}
      {overlay === "rules" ? <RulesSheet mobile={isMobile} /> : null}
      <Toasts />
    </div>
  );
}
