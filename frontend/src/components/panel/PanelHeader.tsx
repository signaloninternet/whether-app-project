import { useEffect, useRef, useState } from "react";
import { openOverlay, openSearch, resetTrip, setView, useStore } from "../../state/store";
import { Toggle, ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import styles from "./panel.module.css";

export function PanelHeader() {
  const view = useStore((s) => s.view);
  const plan = useStore((s) => s.plan);
  const draft = useStore((s) => s.draft);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const trip = draft.origin && draft.destination ? `${draft.origin.name} → ${draft.destination.name}` : null;
  const onPill = () => {
    if (plan && view !== "edit") setView("edit");
    else openSearch(draft.origin ? "destination" : "origin");
  };

  return (
    <div className={styles.header}>
      {view === "route" ? (
        <button type="button" className={styles.back} onClick={() => setView("results")} aria-label="Back to routes">
          <Icon name="back" />
        </button>
      ) : null}
      <button type="button" className={styles.pill} onClick={onPill}>
        <Icon name={trip ? "route" : "search"} size={17} />
        {trip ? <strong>{trip}</strong> : <span>Search places</span>}
      </button>
      <div className={styles.menuWrap} ref={menuRef}>
        <button type="button" className={ui.iconButton} aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="more" size={18} />
        </button>
        {menu ? (
          <div className={styles.menu} role="menu" onClick={() => setMenu(false)}>
            <div className={styles.menuLabel}>Trip</div>
            <button type="button" role="menuitem" className={styles.menuItem} disabled={!plan} onClick={() => openOverlay("share")}>
              <Icon name="link" size={18} /> Share this plan
            </button>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={resetTrip}>
              <Icon name="plus" size={18} /> New trip
            </button>
            <div className={styles.menuDivider} />
            <div className={styles.menuLabel}>Map</div>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => openOverlay("themes")}>
              <Icon name="palette" size={18} /> Map view
            </button>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => openOverlay("rules")}>
              <Icon name="book" size={18} /> Risk rules & data
            </button>
          </div>
        ) : null}
      </div>
      <Toggle
        checked={view === "edit" || !plan}
        labels={["View", "Edit"]}
        title={plan ? "Switch between the trip form and the routes" : "Plan a trip first"}
        onChange={(edit) => plan && setView(edit ? "edit" : "results")}
      />
    </div>
  );
}
