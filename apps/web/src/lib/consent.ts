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
