import { useState } from "react";
import { currentShareUrl, openOverlay, toast } from "../../state/store";
import { Switch, ui } from "../ui/controls";
import { Icon } from "../ui/Icon";
import styles from "./overlays.module.css";

export function ShareModal() {
  const [keepDeparture, setKeepDeparture] = useState(true);
  const [keepRoute, setKeepRoute] = useState(true);
  const url = currentShareUrl(keepDeparture, keepRoute);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard", "Send this link to share the plan, or open it later to re-check the forecast.");
      openOverlay(null);
    } catch {
      toast("Couldn't copy", "Select the link and copy it manually.", "error");
    }
  };

  return (
    <div className={styles.modalScrim} onClick={() => openOverlay(null)}>
      <section className={styles.modal} role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <header className={styles.tabs}>
          <strong>Share</strong>
          <button type="button" className={styles.closeDot} onClick={() => openOverlay(null)} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <input className={styles.linkField} readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
        <div className={styles.divider} />
        <Option icon="calendar" label="Same departure time" checked={keepDeparture} onChange={setKeepDeparture}
          hint="Off: departs whenever the link is opened" />
        <Option icon="route" label="Open the selected route" checked={keepRoute} onChange={setKeepRoute} />
        <button type="button" className={`${ui.primary} ${ui.block}`} style={{ marginTop: 14 }} onClick={copy}>
          Copy link
        </button>
      </section>
    </div>
  );
}

function Option({ icon, label, hint, checked, onChange }: {
  icon: "calendar" | "route";
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.option}>
      <span className={styles.rowIcon}><Icon name={icon} size={18} /></span>
      <span className={styles.rowText}>
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
