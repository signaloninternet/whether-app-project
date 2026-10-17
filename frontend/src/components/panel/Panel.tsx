import { Link } from "react-router-dom";
import type { MapController } from "../../map/controller";
import { openOverlay, resetTrip, useStore } from "../../state/store";
import { ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { PanelContent, PanelFooter } from "./PanelContent";
import { PanelHeader } from "./PanelHeader";
import styles from "./panel.module.css";

/** Desktop layout: the floating card from the reference, docked top-left over the map. */
export function Panel({ controller }: { controller: MapController | null }) {
  const plan = useStore((s) => s.plan);
  return (
    <aside className={styles.panel} aria-label="Trip planner">
      <div className={styles.card}>
        <nav className={styles.rail} aria-label="Tools">
          <Link to="/" className={styles.logo} title="Routecast home" aria-label="Routecast home">R</Link>
          <div className={styles.railSpacer} />
          <button type="button" className={ui.iconButton} title="Fit routes" aria-label="Fit routes on the map"
            disabled={!plan} onClick={() => controller?.fitRoutes()}>
            <Icon name="compass" size={19} />
          </button>
          <button type="button" className={ui.iconButton} title="Map view" aria-label="Map view" onClick={() => openOverlay("themes")}>
            <Icon name="palette" size={19} />
          </button>
          <button type="button" className={ui.iconButton} title="New trip" aria-label="New trip" onClick={resetTrip}>
            <Icon name="plus" size={19} />
          </button>
        </nav>
        <div className={styles.column}>
          <PanelHeader />
          <div className={styles.body} id="panel-body">
            <PanelContent />
          </div>
          <PanelFooter />
        </div>
      </div>
    </aside>
  );
}
