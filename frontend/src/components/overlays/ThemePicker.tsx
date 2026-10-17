import { THEMES, type Theme } from "../../map/themes";
import { openOverlay, setTheme, toggleTerrain, useStore } from "../../state/store";
import { Switch } from "../ui/controls";
import { Icon } from "../ui/Icon";
import styles from "./overlays.module.css";

/** The reference's "Themes" picker: thumbnails of each map view. */
export function ThemePicker({ mobile }: { mobile: boolean }) {
  const theme = useStore((s) => s.theme);
  const terrain = useStore((s) => s.terrain);
  return (
    <>
      <div className={mobile ? styles.scrim : styles.catcher} onClick={() => openOverlay(null)} />
      <section className={mobile ? styles.sheet : styles.themes} aria-label="Map view">
        <header className={styles.themesHead}>
          <h2>Map view</h2>
          <button type="button" className={styles.closeDot} onClick={() => openOverlay(null)} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className={styles.themeGrid} role="radiogroup" aria-label="Map theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === theme} className={styles.themeCard}
              onClick={() => setTheme(t.id)}>
              <Thumbnail theme={t} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <div className={styles.themeRow}>
          <span className={styles.rowIcon}><Icon name="mountain" size={18} /></span>
          <span className={styles.rowText}>
            <strong>3D terrain</strong>
            <span>Tilt the map to see mountain grades</span>
          </span>
          <Switch checked={terrain} onChange={toggleTerrain} label="3D terrain" />
        </div>
      </section>
    </>
  );
}

/** Abstract tile in the reference's style: land, a diagonal road, a water corner, a park. */
function Thumbnail({ theme }: { theme: Theme }) {
  const p = theme.palette;
  if (theme.kind === "satellite") {
    return (
      <svg viewBox="0 0 80 52" className={styles.thumb} aria-hidden="true">
        <defs>
          <linearGradient id="sat" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3f5a34" />
            <stop offset="0.55" stopColor="#6f6a45" />
            <stop offset="1" stopColor="#24384a" />
          </linearGradient>
        </defs>
        <rect width="80" height="52" fill="url(#sat)" />
        <path d="M0 40 C20 30 30 34 46 22 S70 8 80 4" stroke="#e8dcc0" strokeWidth="3" fill="none" opacity="0.9" />
        <circle cx="18" cy="14" r="7" fill="#2f4a2a" opacity="0.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 52" className={styles.thumb} aria-hidden="true">
      <rect width="80" height="52" fill={p.land} />
      {theme.kind === "terrain" ? (
        <path d="M0 52 L18 30 L28 38 L44 18 L62 36 L80 24 L80 52 Z" fill="#d9d1bd" opacity="0.8" />
      ) : null}
      <path d="M54 0 H80 V20 C70 26 62 16 54 0 Z" fill={p.park} />
      <path d="M44 52 C52 36 66 30 80 28 V52 Z" fill={p.water} />
      <path d="M8 52 C22 30 36 18 64 0" stroke={p.roadCasing} strokeWidth="9" fill="none" />
      <path d="M8 52 C22 30 36 18 64 0" stroke={p.roadMotorway} strokeWidth="7" fill="none" />
    </svg>
  );
}
