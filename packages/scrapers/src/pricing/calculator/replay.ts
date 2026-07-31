/**
 * Asking the calculator's own pricing endpoint for the REMAINING volumes, once
 * the browser has proved what that endpoint is (P4, strategy `endpoint_replay`).
 *
 * Why this exists: a probe holds a Chromium for the whole run, and the fleet has
 * ~36 calculator-priced competitors to measure every day on the same worker that
 * scrapes everything else. Reading the first volume in the browser and the rest
 * over HTTP frees that browser after one interaction instead of eight.
 *
 * What keeps it from being "forging requests at someone's private API":
 *
 *   - the request is not invented, it is the one THE PAGE made while we moved its
 *     slider. We change exactly one number in it: the quantity we are asking about.
 *   - GET only, same origin as the pricing page, and only when the quantity is
 *     visible in the query string. A POST body, a signed payload or an endpoint on
 *     another host is not something we understood well enough to repeat.
 *   - no credential is ever created. The cookies the browser already holds for
 *     that origin ride along unchanged; a request that carried an Authorization
 *     header is refused outright rather than re-signed.
 *   - the plan is CONFIRMED before it is trusted: the first replayed volume is one
 *     the browser already measured and screenshotted, and the two numbers have to
 *     agree. A replay that disagrees is dropped and the run finishes in the UI.
 *
 * Pure module: it builds and validates URLs. The transport lives in probe.ts.
 */

import type { PricePath } from "./endpoint";

export interface ReplayPlan {
  /** The observed request, with the quantity parameter identified. */
  url: string;
  qtyParam: string;
  /** Dotted path to the amount inside the response body. */
  path: string;
}

export type ReplayRejection =
  | "not_get"
  | "cross_origin"
  | "qty_not_in_query"
  | "authorized_request";

export type ReplayPlanResult =
  | { ok: true; plan: ReplayPlan }
  | { ok: false; reason: ReplayRejection };

/** Digits only, so "10,000" / "10 000" / "10000" compare as one number. */
function asNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s,_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the replay plan for a request we watched answer with the displayed total.
 *
 * `anchorQty` is the quantity the control was on when that request went out —
 * finding it in the query is what identifies WHICH parameter means "how much".
 */
export function planReplay(
  price: PricePath,
  pageUrl: string,
  anchorQty: number,
): ReplayPlanResult {
  if ((price.method ?? "GET").toUpperCase() !== "GET") return { ok: false, reason: "not_get" };

  const hasAuth = Object.keys(price.requestHeaders ?? {}).some(
    (h) => h.toLowerCase() === "authorization",
  );
  if (hasAuth) return { ok: false, reason: "authorized_request" };

  let target: URL;
  let page: URL;
  try {
    target = new URL(price.url);
    page = new URL(pageUrl);
  } catch {
    return { ok: false, reason: "cross_origin" };
  }
  if (target.origin !== page.origin) return { ok: false, reason: "cross_origin" };

  for (const [key, value] of target.searchParams) {
    if (asNumber(value) === anchorQty) {
      return { ok: true, plan: { url: price.url, qtyParam: key, path: price.path } };
    }
  }
  return { ok: false, reason: "qty_not_in_query" };
}

/** The same request, asking about a different volume. */
export function replayUrl(plan: ReplayPlan, qty: number): string {
  const url = new URL(plan.url);
  url.searchParams.set(plan.qtyParam, String(qty));
  return url.toString();
}

/** The evidence a replayed point carries in place of a screenshot: the request
 * that was made, the body that came back, and where the amount was read from. */
export function replayEvidence(args: {
  url: string;
  qty: number;
  path: string;
  amount: number;
  currency: string;
  body: unknown;
  confirmedAgainst: { qty: number; amount: number };
}): string {
  return JSON.stringify(
    {
      kind: "api_response",
      note:
        "The competitor's own pricing request, replayed at this volume after the " +
        "browser confirmed it returns the same amount the calculator displayed.",
      request: { method: "GET", url: args.url },
      readAt: args.path,
      amount: args.amount,
      currency: args.currency,
      confirmedAgainst: args.confirmedAgainst,
      response: args.body,
    },
    null,
    2,
  );
}
