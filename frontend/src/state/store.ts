import { create } from "zustand";
import { ApiError, api } from "../api/client";
import type { HeatLayer, Heatmap, IntervalMi, Plan, Rules } from "../api/types";
import { type SharedTrip, tripToSearch } from "../lib/shareUrl";
import { browserTimeZone, defaultDeparture, fromLocalInput, zoneAbbreviation } from "../lib/time";
import { DEFAULT_THEME, THEME_BY_ID, type ThemeId } from "../map/themes";

export type View = "edit" | "results" | "route";
export type Overlay = "themes" | "share" | "rules" | null;
export type PlaceField = "origin" | "destination";

export interface PlaceValue {
  name: string;
  label: string;
  lat: number;
  lon: number;
}

export interface Draft {
  origin: PlaceValue | null;
  destination: PlaceValue | null;
  departure: string; // wall-clock at the origin
  timezone: string; // the zone `departure` is read in
  timezoneFromOrigin: boolean;
  departureEdited: boolean;
  loadLb: number;
  intervalMi: IntervalMi;
  hos: boolean;
}

export interface Toast {
  id: number;
  title: string;
  message?: string;
  tone: "info" | "error";
}

interface State {
  rules: Rules | null; // thresholds from the API, so hints and legends match the backend
  draft: Draft;
  plan: Plan | null;
  planStatus: "idle" | "loading" | "error";
  planStartedAt: number;
  planError: ApiError | null;
  heatmap: Heatmap | null;
  heatStatus: "idle" | "loading" | "ready" | "error";
  heatNote: string | null; // e.g. "forecast service busy, retrying"
  view: View;
  selectedRouteId: string | null;
  hoveredRouteId: string | null;
  focus: { routeId: string; index: number } | null;
  hour: number; // 0-48, hours after departure
  playing: boolean;
  heatLayer: HeatLayer;
  heatVisible: boolean;
  theme: ThemeId;
  terrain: boolean;
  overlay: Overlay;
  search: PlaceField | null;
  toasts: Toast[];
}

const THEME_KEY = "routecast.theme";
const MAX_AHEAD_MS = 7 * 24 * 3_600_000;

function savedTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_KEY) as ThemeId | null;
    return saved && saved in THEME_BY_ID ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function initialDraft(): Draft {
  const tz = browserTimeZone();
  return {
    origin: null,
    destination: null,
    departure: defaultDeparture(tz),
    timezone: tz,
    timezoneFromOrigin: false,
    departureEdited: false,
    loadLb: 40_000,
    intervalMi: 25,
    hos: false,
  };
}

export const useStore = create<State>(() => ({
  rules: null,
  draft: initialDraft(),
  plan: null,
  planStatus: "idle",
  planStartedAt: 0,
  planError: null,
  heatmap: null,
  heatStatus: "idle",
  heatNote: null,
  view: "edit",
  selectedRouteId: null,
  hoveredRouteId: null,
  focus: null,
  hour: 0,
  playing: false,
  heatLayer: "risk",
  heatVisible: true,
  theme: savedTheme(),
  terrain: false,
  overlay: null,
  search: null,
  toasts: [],
}));

const set = useStore.setState;
const get = useStore.getState;

// --- toasts ------------------------------------------------------------------------

let toastId = 0;
export function toast(title: string, message?: string, tone: Toast["tone"] = "info") {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-2), { id, title, message, tone }] }));
  window.setTimeout(() => dismissToast(id), tone === "error" ? 6000 : 3500);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export async function loadRules() {
  if (get().rules) return;
  try {
    set({ rules: await api.rules() });
  } catch {
    // Hints fall back to the plan's copy of the rules once a plan loads.
  }
}

// --- trip draft ----------------------------------------------------------------------

export function updateDraft(patch: Partial<Draft>) {
  set((s) => ({ draft: { ...s.draft, ...patch } }));
}

let tzRequest: AbortController | null = null;
let tzPending: Promise<void> | null = null;

export function setPlace(field: PlaceField, place: PlaceValue | null) {
  if (field === "origin") {
    // The old origin's zone no longer applies; until the new one resolves the
    // server works it out from the coordinates.
    updateDraft({ origin: place, timezoneFromOrigin: false });
    if (place) resolveOriginTimezone(place);
    return;
  }
  updateDraft({ destination: place });
}

function resolveOriginTimezone(place: PlaceValue) {
  tzPending = lookUpOriginTimezone(place);
  return tzPending;
}

/** Departure is entered in the origin's local time, so learn that zone as soon as the origin is known. */
async function lookUpOriginTimezone(place: PlaceValue) {
  tzRequest?.abort();
  tzRequest = new AbortController();
  try {
    const tz = await api.timezone(place.lat, place.lon, tzRequest.signal);
    const { draft } = get();
    if (draft.origin !== place) return; // origin changed meanwhile
    updateDraft({
      timezone: tz.name,
      timezoneFromOrigin: true,
      departure: draft.departureEdited ? draft.departure : defaultDeparture(tz.name),
    });
  } catch {
    // Keep the browser's zone; the hint under the field says which zone is used.
  }
}

export function swapPlaces() {
  const { origin, destination } = get().draft;
  updateDraft({ origin: destination, destination: origin, timezoneFromOrigin: false });
  if (destination) resolveOriginTimezone(destination);
}

export function draftProblem(draft: Draft, now = Date.now()): string | null {
  if (!draft.origin) return "Choose where the load picks up.";
  if (!draft.destination) return "Choose where it's going.";
  const departure = fromLocalInput(draft.departure, draft.timezone);
  if (!Number.isFinite(departure)) return "Pick a departure date and time.";
  if (departure < now - 3_600_000) return "Departure is in the past.";
  if (departure > now + MAX_AHEAD_MS) return "Pick a departure within the next 7 days (forecast range).";
  if (!Number.isFinite(draft.loadLb) || draft.loadLb < 0 || draft.loadLb > 80_000) return "Load weight must be 0–80,000 lb.";
  return null;
}

// --- planning ---------------------------------------------------------------------------

let planRequest: AbortController | null = null;
let planRequestKey = "";
let heatRequest: AbortController | null = null;

function placeLabel(p: PlaceValue): string {
  return p.label ? `${p.name}, ${p.label}` : p.name;
}

export async function runPlan(preferredRoute: string | null = null) {
  const problem = draftProblem(get().draft);
  if (problem) {
    toast("Can't plan yet", problem, "error");
    return;
  }
  // The same trip is already being planned (double click, or an effect re-run): let it finish.
  const key = JSON.stringify(get().draft);
  if (get().planStatus === "loading" && key === planRequestKey) return;
  planRequestKey = key;
  planRequest?.abort();
  heatRequest?.abort();
  const request = (planRequest = new AbortController());
  set({ planStatus: "loading", planStartedAt: Date.now(), planError: null, playing: false, focus: null, search: null });
  try {
    // Wait (briefly) for the origin's zone so the departure is read in local time.
    if (tzPending) await Promise.race([tzPending, new Promise((r) => setTimeout(r, 4000))]);
    if (request.signal.aborted) return;
    const draft = get().draft;
    const plan = await api.plan(
      {
        origin: { lat: draft.origin!.lat, lon: draft.origin!.lon, label: placeLabel(draft.origin!) },
        destination: { lat: draft.destination!.lat, lon: draft.destination!.lon, label: placeLabel(draft.destination!) },
        departure: draft.departure,
        // Only a zone known to belong to this origin; otherwise the server resolves it.
        ...(draft.timezoneFromOrigin ? { timezone: draft.timezone } : {}),
        load_weight_lb: Math.round(draft.loadLb),
        interval_mi: draft.intervalMi,
        hos_breaks: draft.hos,
      },
      request.signal,
    );
    if (request.signal.aborted) return;
    const selected = plan.routes.some((r) => r.id === preferredRoute) ? preferredRoute! : plan.recommendation.route_id;
    set({
      plan,
      rules: plan.rules,
      planStatus: "idle",
      heatmap: null,
      heatStatus: "idle",
      heatNote: null,
      view: "results",
      selectedRouteId: selected,
      hoveredRouteId: null,
      hour: 0,
    });
    syncUrl();
    loadHeatmap();
  } catch (err) {
    if ((err as Error).name === "AbortError" || request.signal.aborted) return;
    const error = err instanceof ApiError ? err : new ApiError("unknown", "Something went wrong.", 0);
    set({ planStatus: "error", planError: error });
    toast("Couldn't plan this trip", error.message, "error");
  }
}

const HEAT_RETRIES = 3;

export async function loadHeatmap(attempt = 1) {
  const { plan } = get();
  if (!plan) return;
  heatRequest?.abort();
  const request = (heatRequest = new AbortController());
  set({ heatStatus: "loading", ...(attempt === 1 ? { heatNote: null } : {}) });
  try {
    const heatmap = await api.heatmap(plan.heatmap_request, request.signal);
    if (request.signal.aborted || get().plan !== plan) return;
    set({ heatmap, heatStatus: "ready", heatNote: null });
  } catch (err) {
    if ((err as Error).name === "AbortError" || request.signal.aborted) return;
    // Free-tier forecast limits reset within a minute: back off and try again.
    if (err instanceof ApiError && err.code === "upstream_busy" && attempt < HEAT_RETRIES) {
      set({ heatNote: "forecast service busy, retrying…" });
      window.setTimeout(() => {
        if (get().plan === plan && heatRequest === request) loadHeatmap(attempt + 1);
      }, 15_000 * attempt);
      return;
    }
    set({ heatStatus: "error", heatNote: null });
  }
}

export function applySharedTrip(trip: SharedTrip) {
  const timezone = trip.timezone ?? browserTimeZone();
  set({
    draft: {
      origin: trip.origin,
      destination: trip.destination,
      departure: trip.departure ?? defaultDeparture(timezone),
      timezone,
      timezoneFromOrigin: Boolean(trip.timezone),
      departureEdited: Boolean(trip.departure),
      loadLb: trip.loadLb,
      intervalMi: trip.intervalMi,
      hos: trip.hos,
    },
  });
  if (!trip.timezone) resolveOriginTimezone(trip.origin);
}

export function currentShareUrl(includeDeparture: boolean, includeRoute: boolean): string {
  const { draft, selectedRouteId } = get();
  if (!draft.origin || !draft.destination) return window.location.origin + "/plan";
  const search = tripToSearch({
    origin: draft.origin,
    destination: draft.destination,
    departure: includeDeparture ? draft.departure : null,
    timezone: draft.timezoneFromOrigin ? draft.timezone : null,
    loadLb: draft.loadLb,
    intervalMi: draft.intervalMi,
    hos: draft.hos,
    routeId: includeRoute ? selectedRouteId : null,
  });
  return `${window.location.origin}/plan${search}`;
}

function syncUrl() {
  const url = currentShareUrl(true, true);
  window.history.replaceState(null, "", url.replace(window.location.origin, ""));
}

export function resetTrip() {
  planRequest?.abort();
  heatRequest?.abort();
  set({
    draft: initialDraft(),
    plan: null,
    planStatus: "idle",
    heatmap: null,
    heatStatus: "idle",
    view: "edit",
    selectedRouteId: null,
    focus: null,
    hour: 0,
    playing: false,
  });
  window.history.replaceState(null, "", "/plan");
}

// --- selection & view -------------------------------------------------------------

export function selectRoute(routeId: string, openDetail = true) {
  set((s) => ({ selectedRouteId: routeId, focus: null, view: openDetail ? "route" : s.view === "edit" ? "edit" : s.view }));
  syncUrl();
}

export function hoverRoute(routeId: string | null) {
  if (get().hoveredRouteId !== routeId) set({ hoveredRouteId: routeId });
}

export function focusCheckpoint(routeId: string, index: number) {
  set({ selectedRouteId: routeId, focus: { routeId, index }, view: "route" });
}

export function clearFocus() {
  set({ focus: null });
}

export function setView(view: View) {
  set({ view, focus: view === "route" ? get().focus : null });
}

// --- timeline, layers, map view -----------------------------------------------------

export function setHour(hour: number) {
  set({ hour: Math.max(0, Math.min(48, hour)) });
}

export function setPlaying(playing: boolean) {
  set((s) => ({ playing, hour: playing && s.hour >= 48 ? 0 : s.hour }));
}

export function setHeatLayer(layer: HeatLayer) {
  set({ heatLayer: layer, heatVisible: true });
}

export function toggleHeat() {
  set((s) => ({ heatVisible: !s.heatVisible }));
}

export function setTheme(theme: ThemeId) {
  set({ theme });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode: the choice just isn't remembered
  }
}

export function toggleTerrain() {
  set((s) => ({ terrain: !s.terrain }));
}

export function openOverlay(overlay: Overlay) {
  set({ overlay });
}

export function openSearch(field: PlaceField | null) {
  set({ search: field });
}

/** Departure is always wall-clock time at the pickup: "Local time at Chicago (CDT)". */
export function departureZoneHint(draft: Draft): string {
  if (!draft.origin) return "Local time at the pickup";
  if (!draft.timezoneFromOrigin) return `Local time at ${draft.origin.name}`;
  const abbr = zoneAbbreviation(draft.timezone, fromLocalInput(draft.departure, draft.timezone) || Date.now());
  return `Local time at ${draft.origin.name} (${abbr})`;
}
