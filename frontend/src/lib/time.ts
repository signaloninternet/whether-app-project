/**
 * Time helpers. Departure is entered as wall-clock time at the origin and
 * every time in the UI is shown in the origin's zone, labelled once.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
    formatters.set(key, f);
  }
  return f;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** "Sat 2:30 PM" */
export function formatDayTime(iso: string | number, timeZone: string): string {
  return formatter(timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "Sat, Oct 18" */
export function formatDate(iso: string | number, timeZone: string): string {
  return formatter(timeZone, { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

/** "2 PM" */
export function formatHour(iso: string | number, timeZone: string): string {
  return formatter(timeZone, { hour: "numeric" }).format(new Date(iso));
}

/** Hour of day (0-23) at the instant, in the zone. */
export function localHour(iso: string | number, timeZone: string): number {
  return Number(formatter(timeZone, { hour: "numeric", hourCycle: "h23" }).format(new Date(iso))) % 24;
}

/** "CDT" for the zone at a given instant. */
export function zoneAbbreviation(timeZone: string, at: number = Date.now()): string {
  const part = formatter(timeZone, { timeZoneName: "short" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "16h 28m", "45m" */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function wallClockParts(epoch: number, timeZone: string) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/** Wall-clock "YYYY-MM-DDTHH:MM" in ``timeZone`` for an instant. */
export function toLocalInput(epoch: number, timeZone: string): string {
  const { y, mo, d, h, mi } = wallClockParts(epoch, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

function offsetAt(epoch: number, timeZone: string): number {
  const { y, mo, d, h, mi } = wallClockParts(epoch, timeZone);
  return Date.UTC(y, mo - 1, d, h, mi) - Math.floor(epoch / 60_000) * 60_000;
}

/**
 * Instant for a wall-clock "YYYY-MM-DDTHH:MM" in ``timeZone``, resolved like
 * Python's ``fold=0`` (as the API does): an ambiguous time (clocks back) is
 * its first occurrence, and a time skipped by clocks going forward uses the
 * offset from before the change.
 */
export function fromLocalInput(local: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return Number.NaN;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const DAY = 86_400_000;
  const before = asUtc - offsetAt(asUtc - DAY, timeZone);
  if (toLocalInput(before, timeZone) === local.slice(0, 16)) return before;
  const after = asUtc - offsetAt(asUtc + DAY, timeZone);
  if (toLocalInput(after, timeZone) === local.slice(0, 16)) return after;
  return before; // inside a spring-forward gap
}

/** Next quarter hour, at least 10 minutes from now, as a wall-clock input value. */
export function defaultDeparture(timeZone: string, now: number = Date.now()): string {
  const quarter = 15 * 60_000;
  return toLocalInput(Math.ceil((now + 10 * 60_000) / quarter) * quarter, timeZone);
}
