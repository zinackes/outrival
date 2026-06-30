// patch-28 / scope-persistence — the active product scope, single source of truth.
//
// The scope is persisted in a COOKIE (not localStorage) so the *server* can read it
// during render and seed the right React Query cache — no flash, no client-side
// reconciliation. The cookie rides every request, so the scope survives navigation
// onto any route natively (no per-link ?product= threading, no path allowlist).
//
// `?product=` stays an optional *inbound* override (a shareable deep-link): when the
// URL carries it, it wins over the cookie. Active switching collapses the URL back to
// the cookie so a stale param can't fight the user's pick.
//
// This module is runtime-agnostic (no React, no next/headers) so both client and
// server can import it. The cookie name is intentionally distinct from the legacy
// localStorage key — a clean cutover.

export const ALL_PRODUCTS = "all";
export const PRODUCT_COOKIE = "outrival.product";

// 1 year — a long-lived UI preference, refreshed on every switch.
export const PRODUCT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Collapse a raw scope value (URL param or cookie) to a product id, or `null` for
 * "all products". Empty strings and the "all" sentinel both mean no scope.
 */
export function normalizeScope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v === ALL_PRODUCTS) return null;
  return v;
}
