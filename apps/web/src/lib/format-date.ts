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

// Time only — e.g. "21:08" (FR) / "9:08 PM" (US).
export function formatTime(
  input: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return asDate(input).toLocaleTimeString(LOCALE, { hour12: prefersHour12(), ...opts });
}
