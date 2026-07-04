const CONSENT_COOKIE = "ph_consent";
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;

export type ConsentState = "granted" | "denied" | "unset";

export function getConsent(): ConsentState {
  if (typeof document === "undefined") return "unset";
  const match = document.cookie.match(/(?:^|;\s*)ph_consent=(granted|denied)/);
  return (match?.[1] as ConsentState | undefined) ?? "unset";
}

export function setConsent(state: "granted" | "denied"): void {
  if (typeof document === "undefined") return;
  document.cookie = `${CONSENT_COOKIE}=${state}; path=/; max-age=${SIX_MONTHS_SECONDS}; SameSite=Lax`;
}

/** Event the consent banner listens for to re-open the preferences panel, so a
 * choice can be reviewed/withdrawn as easily as it was given (CNIL symmetry). */
export const COOKIE_PREFS_EVENT = "outrival:cookie-preferences";

/** Re-open the cookie preferences panel from anywhere (e.g. the footer link). */
export function openCookiePreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COOKIE_PREFS_EVENT));
}
