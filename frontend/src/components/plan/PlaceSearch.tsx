import { type KeyboardEvent, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Place } from "../../api/types";
import { openSearch, type PlaceValue, setPlace, toast, useStore } from "../../state/store";
import { Icon } from "../ui/Icon";
import styles from "./search.module.css";

type Status = "idle" | "searching" | "done" | "error";

function toValue(p: Place): PlaceValue {
  return { name: p.name, label: p.label, lat: p.lat, lon: p.lon };
}

/** Place search for the pickup / drop-off fields. */
export function PlaceSearch({ mobile }: { mobile: boolean }) {
  const field = useStore((s) => s.search);
  const draft = useStore((s) => s.draft);
  // Rendered with key={field}, so switching fields starts a fresh search.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(0);
  const other = field === "origin" ? draft.destination : draft.origin;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("searching");
      try {
        const found = await api.geocode(q, other ? { lat: other.lat, lon: other.lon } : null, controller.signal);
        setResults(found);
        setActive(0);
        setStatus("done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setStatus("error");
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, other]);

  if (!field) return null;

  const choose = (place: PlaceValue) => {
    setPlace(field, place);
    // Pickup chosen first? Go straight on to the drop-off.
    openSearch(field === "origin" && !draft.destination ? "destination" : null);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setStatus("searching");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const lat = Number(coords.latitude.toFixed(5));
        const lon = Number(coords.longitude.toFixed(5));
        const place = await api.reverse(lat, lon).catch(() => null);
        choose(place ? toValue({ ...place, lat, lon }) : { name: "My location", label: `${lat}, ${lon}`, lat, lon });
      },
      () => {
        setStatus("idle");
        toast("Location unavailable", "Allow location access or type a place.", "error");
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") openSearch(null);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    }
    if (e.key === "Enter" && results[active]) choose(toValue(results[active]));
  };

  return (
    <>
      {mobile ? null : <div className={styles.catcher} onClick={() => openSearch(null)} />}
      <div className={mobile ? styles.sheet : styles.popover} role="dialog"
        aria-label={field === "origin" ? "Search pickup" : "Search drop-off"}>
        <div className={styles.inputRow}>
          {mobile ? (
            <button type="button" className={styles.close} onClick={() => openSearch(null)} aria-label="Close search">
              <Icon name="back" />
            </button>
          ) : null}
          <input autoFocus className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey} placeholder={field === "origin" ? "Search pickup…" : "Search drop-off…"}
            role="combobox" aria-expanded={results.length > 0} aria-controls="place-results" aria-autocomplete="list"
            aria-activedescendant={results[active] ? `place-${active}` : undefined} />
        </div>
        <div className={styles.results} id="place-results" role="listbox">
          {query.trim().length < 2 ? (
            <>
              {"geolocation" in navigator ? (
                <button type="button" className={styles.row} onClick={useMyLocation}>
                  <Icon name="locate" size={18} /> <strong>Use my current location</strong>
                </button>
              ) : null}
              <p className={styles.empty}>Search by city, address, or paste “lat, lon”</p>
            </>
          ) : null}
          {status === "searching" && !results.length ? <p className={styles.empty}>Searching…</p> : null}
          {status === "done" && !results.length ? <p className={styles.empty}>No places match “{query}”.</p> : null}
          {status === "error" ? <p className={styles.empty}>Search is unavailable right now. Try again.</p> : null}
          {results.map((place, i) => (
            <button key={`${place.lat},${place.lon},${i}`} id={`place-${i}`} type="button" role="option"
              aria-selected={i === active} className={styles.result} onMouseEnter={() => setActive(i)}
              onClick={() => choose(toValue(place))}>
              <strong>{place.name}</strong>
              {place.label ? <span>{place.label}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

