// Centralized user-facing date/time formatting.
//
// The product ships in English (see .claude/rules/language.md), so the locale TEXT
// stays "en-US" — month names and date ordering never localize. What DOES adapt to
// the viewer is the clock: a French viewer sees 24h ("21:08"), a US viewer 12h
// ("9:08 PM"). The hour cycle is read once from the browser's resolved locale (Intl),
// so this needs no setting and no DB column. Times render in the viewer's local
// timezone (the Intl default), which is what "their region" means for display.
//
// Inputs must be absolute instants — ISO strings carry their offset (…Z / +00:00),
// epoch numbers are absolute, Date objects already are. Naive "YYYY-MM-DD HH:MM:SS"
// strings (no zone) are a server bug, not handled here: the API wraps such columns
// in `AT TIME ZONE 'UTC'` so they arrive as proper ISO.

// Fixed English locale — keeps month/day names and date order stable everywhere.
const LOCALE = "en-US";

// Resolved lazily on the client and cached (it can't change within a session). On
// the server (SSR, no navigator) we default to the en-US 12-hour clock; the client
// re-resolves on hydration — same nature as the timezone difference that already
// exists between a UTC server render and a local-tz client render.
let cachedHour12: boolean | undefined;

function prefersHour12(): boolean {
  if (typeof navigator === "undefined") return true;
  if (cachedHour12 === undefined) {
    try {
      const hc = new Intl.DateTimeFormat(navigator.language || LOCALE, {
        hour: "numeric",
      }).resolvedOptions().hourCycle;
      // h11/h12 → 12-hour (AM/PM); h23/h24 → 24-hour.
      cachedHour12 = hc === "h11" || hc === "h12";
    } catch {
      cachedHour12 = true;
    }
  }
  return cachedHour12;
}

function asDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

// Date + time — e.g. "Jun 7, 2026, 21:08" (FR) / "Jun 7, 2026, 9:08 PM" (US).
export function formatDateTime(
  input: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return asDate(input).toLocaleString(LOCALE, { hour12: prefersHour12(), ...opts });
}

// Date only — e.g. "Jun 7, 2026". Hour cycle is irrelevant but harmless; routing
// these through the same helper keeps every date in the app on one source of truth.
export function formatDate(
  input: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return asDate(input).toLocaleDateString(LOCALE, opts);
}

// Compact age for a dense list row: "4m", "11h", "3d", "2w", "5mo".
//
// The long form ("about 11 hours" next to "20 days") ragged the right edge of every
// list it appeared in and spent width on words nobody reads twice. One or two digits
// plus a unit letter stays tabular, so ages line up down the column. Buckets are
// coarse on purpose: past a week, "when exactly" belongs to the detail, not the row.
export function shortAge(input: Date | string | number): string {
  const mins = Math.max(0, Math.floor((Date.now() - asDate(input).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

// Long age for a single headline instant: "just now", "3 hours ago", "12 days ago".
//
// The counterpart of `shortAge`: nothing lines up in a column here, so the reader gets
// words instead of letters. Used where the age IS the message — a battle card saying
// how long ago it was written — because "Jun 7, 2026" makes the reader subtract dates
// to answer the only question they had. Singular/plural is spelled out rather than
// run through Intl.RelativeTimeFormat, whose "last week"/"yesterday" numeric:auto
// wording drifts from the buckets below.
export function longAge(input: Date | string | number): string {
  const mins = Math.max(0, Math.floor((Date.now() - asDate(input).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

// Month bucket — "2026-02" → "Feb 2026".
//
// The API buckets months by their key, and that key stays the data: sort order, React
// keys and CSV exports keep reading "2026-02". Only the label changes, because a
// column of "2026-02 / 2026-03" makes the reader parse digits to know which month
// they are looking at.
//
// Built and formatted in UTC on purpose: `new Date("2026-02")` is UTC midnight, and
// rendering that in a local timezone west of Greenwich would print January.
// Anything that is not a YYYY-MM key is echoed back rather than turned into
// "Invalid Date".
export function formatMonth(
  input: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" },
): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input);
  if (!match) return input;
  const [, year, month] = match;
  if (!year || !month) return input;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString(LOCALE, {
    timeZone: "UTC",
    ...opts,
  });
}

// Time only — e.g. "21:08" (FR) / "9:08 PM" (US).
export function formatTime(
  input: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return asDate(input).toLocaleTimeString(LOCALE, { hour12: prefersHour12(), ...opts });
}
