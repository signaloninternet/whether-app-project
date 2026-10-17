import type { IntervalMi, Rules } from "../../api/types";
import { defaultDeparture } from "../../lib/time";
import {
  departureZoneHint,
  type Draft,
  openSearch,
  type PlaceValue,
  runPlan,
  setPlace,
  swapPlaces,
  updateDraft,
  useStore,
} from "../../state/store";
import { Segmented, Sticker, Switch } from "../ui/controls";
import { Icon } from "../ui/Icon";
import styles from "./form.module.css";

interface Example {
  title: string;
  note: string;
  origin: PlaceValue;
  destination: PlaceValue;
}

/** Real corridors with a weather story, prefilled with coordinates (no geocoding needed). */
export const EXAMPLES: Example[] = [
  { title: "Chicago → Denver", note: "I-80 across the plains",
    origin: { name: "Chicago", label: "Illinois, United States", lat: 41.8781, lon: -87.6298 },
    destination: { name: "Denver", label: "Colorado, United States", lat: 39.7392, lon: -104.9903 } },
  { title: "Salt Lake City → Cheyenne", note: "Wyoming crosswinds",
    origin: { name: "Salt Lake City", label: "Utah, United States", lat: 40.7608, lon: -111.891 },
    destination: { name: "Cheyenne", label: "Wyoming, United States", lat: 41.14, lon: -104.8202 } },
  { title: "Seattle → Spokane", note: "Snoqualmie Pass snow",
    origin: { name: "Seattle", label: "Washington, United States", lat: 47.6062, lon: -122.3321 },
    destination: { name: "Spokane", label: "Washington, United States", lat: 47.6588, lon: -117.426 } },
  { title: "Dallas → Atlanta", note: "Southern storm belt",
    origin: { name: "Dallas", label: "Texas, United States", lat: 32.7767, lon: -96.797 },
    destination: { name: "Atlanta", label: "Georgia, United States", lat: 33.749, lon: -84.388 } },
  { title: "New York → Los Angeles", note: "Coast to coast",
    origin: { name: "New York", label: "New York, United States", lat: 40.7128, lon: -74.006 },
    destination: { name: "Los Angeles", label: "California, United States", lat: 34.0522, lon: -118.2437 } },
];

const LOAD_PRESETS = [15_000, 30_000, 40_000, 45_000];

function loadHint(load: number, rules: Rules | null): { strong: string; rest: string } {
  const active = (rules?.load_rules ?? []).filter((r) => load > r.load_over_lb);
  if (!active.length) {
    return { strong: "Base wind thresholds apply.", rest: " Load rules start above 30,000 lb." };
  }
  const text = active
    .sort((a, b) => a.min_wind_mph - b.min_wind_mph)
    .map((r) => `${r.min_wind_mph}–${r.max_wind_mph - 1} mph wind becomes ${r.result === 4 ? "No Travel" : "Severe"}`)
    .join("; ");
  return { strong: "Heavy-load rules apply: ", rest: `${text}.` };
}

function PlaceButton({ field, place, placeholder, icon }: {
  field: "origin" | "destination";
  place: PlaceValue | null;
  placeholder: string;
  icon: string;
}) {
  const searching = useStore((s) => s.search === field);
  return (
    <button type="button" className={styles.place} aria-expanded={searching} onClick={() => openSearch(field)}>
      <Sticker emoji={icon} size={22} />
      <span className={styles.placeText}>
        {place ? (
          <>
            <strong>{place.name}</strong>
            {place.label ? <span>{place.label}</span> : null}
          </>
        ) : (
          <strong className={styles.placeholder}>{placeholder}</strong>
        )}
      </span>
    </button>
  );
}

export function PlanForm() {
  const draft = useStore((s) => s.draft);
  const plan = useStore((s) => s.plan);
  const rules = useStore((s) => s.rules);
  const hint = loadHint(draft.loadLb, rules);

  const pickExample = (ex: Example) => {
    setPlace("origin", ex.origin);
    setPlace("destination", ex.destination);
    runPlan();
  };

  return (
    <div>
      {!plan ? (
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>Where to?</h1>
          <p className={styles.heroText}>
            Three real truck routes, checked against the forecast for the hour you reach each checkpoint.
          </p>
          <div className={styles.examples}>
            {EXAMPLES.slice(0, 4).map((ex) => (
              <button key={ex.title} type="button" className={styles.example} onClick={() => pickExample(ex)}>
                <strong>{ex.title}</strong>
                <span>{ex.note}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.section}>
        <span className={styles.label}>Route</span>
        <div className={styles.places}>
          <PlaceButton field="origin" place={draft.origin} placeholder="Pickup: city, address or lat, lon" icon="📦" />
          <PlaceButton field="destination" place={draft.destination} placeholder="Drop-off" icon="🏁" />
          <button type="button" className={styles.swap} onClick={swapPlaces} aria-label="Swap pickup and drop-off"
            disabled={!draft.origin && !draft.destination}>
            <Icon name="swap" size={17} />
          </button>
        </div>
      </div>

      <DepartureField draft={draft} />

      <div className={styles.section}>
        <label className={styles.label} htmlFor="load">Load weight</label>
        <div className={styles.group}>
          <div className={styles.row}>
            <input id="load" className={styles.input} inputMode="numeric" autoComplete="off"
              value={draft.loadLb.toLocaleString("en-US")}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^\d]/g, "");
                updateDraft({ loadLb: Math.min(80_000, Number(digits || 0)) });
              }} />
            <span className={styles.unit}>lb</span>
          </div>
        </div>
        <div className={styles.presets}>
          {LOAD_PRESETS.map((lb) => (
            <button key={lb} type="button" className={styles.preset} aria-pressed={draft.loadLb === lb}
              onClick={() => updateDraft({ loadLb: lb })}>
              {(lb / 1000).toFixed(0)}k
            </button>
          ))}
        </div>
        <p className={styles.hint}><span className={styles.hintStrong}>{hint.strong}</span>{hint.rest}</p>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Sample the weather every</span>
        <Segmented<IntervalMi>
          label="Checkpoint spacing"
          value={draft.intervalMi}
          onChange={(intervalMi) => updateDraft({ intervalMi })}
          options={[10, 25, 50].map((mi) => ({ value: mi as IntervalMi, label: `${mi} mi` }))}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.optionRow}>
          <span className={styles.optionIcon}><Icon name="clock" size={19} /></span>
          <span className={styles.optionText}>
            <strong>Hours-of-service breaks</strong>
            <span>30 min after 8 h driving, 10 h off after 11 h. Shifts later ETAs.</span>
          </span>
          <Switch checked={draft.hos} label="Hours-of-service breaks" onChange={(hos) => updateDraft({ hos })} />
        </div>
      </div>
    </div>
  );
}

function DepartureField({ draft }: { draft: Draft }) {
  return (
    <div className={styles.section}>
      <div className={styles.row} style={{ justifyContent: "space-between" }}>
        <label className={styles.label} htmlFor="departure">Departure</label>
        <button type="button" className={styles.textLink} style={{ marginBottom: 6, marginRight: 4 }}
          onClick={() => updateDraft({ departure: defaultDeparture(draft.timezone), departureEdited: false })}>
          Leave now
        </button>
      </div>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Leaves</span>
        <input id="departure" type="datetime-local" className={styles.input} value={draft.departure}
          onChange={(e) => e.target.value && updateDraft({ departure: e.target.value, departureEdited: true })} />
      </div>
      <p className={styles.hint}>{departureZoneHint(draft)}</p>
    </div>
  );
}
