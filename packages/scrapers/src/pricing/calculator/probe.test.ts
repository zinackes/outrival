/**
 * The probe, driven for real: a live Chromium against a live HTTP server serving
 * the fixture calculators. Nothing here is mocked — a stubbed page would test the
 * parser and skip the part that actually breaks (setting a controlled input,
 * waiting out a debounce, reading a number a script wrote).
 *
 * Skipped, loudly, when no Chromium is installed: the pure ranking/validation
 * rules are covered by controls/readings/endpoint tests, so a machine without a
 * browser still gets a meaningful run instead of a red one.
 */
// FIRST import: it sets the crawl gap / pacing env the modules below read at load
// time (see __fixtures__/test-env.ts for why it can't live in this file's body).
import "./__fixtures__/test-env";
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { validateProbeSeries } from "@outrival/shared";
import { probeCalculator } from "./probe";
import {
  SLIDER_PAGE,
  ENDPOINT_PAGE,
  DESCENDING_PAGE,
  UNKNOWN_UNIT_PAGE,
  CONSENT_PAGE,
  FLAKY_PAGE,
  GUARDED_ENDPOINT_PAGE,
  estimateResponse,
} from "./__fixtures__/calculators";

const PAGES: Record<string, string> = {
  "/slider": SLIDER_PAGE,
  "/endpoint": ENDPOINT_PAGE,
  "/descending": DESCENDING_PAGE,
  "/unknown-unit": UNKNOWN_UNIT_PAGE,
  "/consent": CONSENT_PAGE,
  "/flaky": FLAKY_PAGE,
  "/guarded-endpoint": GUARDED_ENDPOINT_PAGE,
};

let server: ReturnType<typeof Bun.serve> | null = null;
let base = "";

// Resolved at MODULE level, not in beforeAll: `it.skipIf` is evaluated when the
// test is declared, so a flag set later would skip everything, silently and
// always — the exact failure this guard exists to avoid.
const hasBrowser = await (async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    console.warn("[probe.test] no Chromium available — browser cases skipped");
    return false;
  }
})();

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/estimate") {
        return new Response(estimateResponse(Number(url.searchParams.get("qty") ?? 0)), {
          headers: { "content-type": "application/json" },
        });
      }
      // Answers the PAGE (which sends a Referer) and refuses anything else — the
      // referer/CSRF check a real pricing endpoint often carries.
      if (url.pathname === "/api/estimate-guarded") {
        if (!req.headers.get("referer")) return new Response("forbidden", { status: 403 });
        return new Response(estimateResponse(Number(url.searchParams.get("qty") ?? 0)), {
          headers: { "content-type": "application/json" },
        });
      }
      const page = PAGES[url.pathname];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

const QUANTITIES = [1_000, 10_000, 100_000];
// The probe's OWN budget is deliberately shorter than the test's. Left equal, a
// slow box (the whole monorepo testing in parallel on four cores) races them and
// the loser is the test runner, which reports "timed out" instead of the typed
// outcome the probe would have returned. Bounded by the thing under test.
const PROBE_BUDGET_MS = 40_000;
const TIMEOUT = 120_000;
const probe = (path: string) =>
  probeCalculator({ url: `${base}${path}`, quantities: QUANTITIES, timeoutMs: PROBE_BUDGET_MS });

describe("probeCalculator (live browser)", () => {
  it.skipIf(!hasBrowser)(
    "measures a slider calculator and comes back with proof",
    async () => {
      const out = await probe("/slider");
      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(out.strategy).toBe("ui");
      expect(out.unit).toBe("request");
      expect(out.currency).toBe("USD");
      expect(out.readings.map((r) => r.qty)).toEqual(QUANTITIES);
      // $25 minimum, then $0.002/request — the fixture's own rate card.
      expect(out.readings.map((r) => r.cost)).toEqual([25, 25, 200]);
      // Every measured point carries the screen it was read off.
      expect(out.evidence.map((e) => e.qty).sort((a, b) => a - b)).toEqual(QUANTITIES);
      expect(out.evidence.every((e) => e.kind === "screenshot")).toBe(true);
      for (const e of out.evidence) expect(e.png!.length).toBeGreaterThan(0);
      // And the recipe is cacheable for the next run.
      expect(out.spec.control.unit).toBe("request");
      expect(out.spec.total.selector.length).toBeGreaterThan(0);

      const verdict = validateProbeSeries(out.readings);
      expect(verdict.ok).toBe(true);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "drives the first volume, then asks the page's own endpoint for the rest",
    async () => {
      const out = await probe("/endpoint");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.strategy).toBe("endpoint_replay");
      expect(out.readings.map((r) => r.cost)).toEqual([25, 25, 200]);
      expect(validateProbeSeries(out.readings).ok).toBe(true);

      // The anchor is screenshotted; the replayed volumes carry the request and
      // the answer it gave instead.
      const kinds = out.evidence
        .slice()
        .sort((a, b) => a.qty - b.qty)
        .map((e) => e.kind);
      expect(kinds).toEqual(["screenshot", "api_response", "api_response"]);
      expect(out.anchorPng?.length ?? 0).toBeGreaterThan(0);

      const proof = JSON.parse(out.evidence.find((e) => e.qty === 100_000)!.json!);
      expect(proof.request.url).toContain("qty=100000");
      expect(proof.amount).toBe(200);
      // A replay is only ever used once it agreed with a screenshot-backed reading.
      expect(proof.confirmedAgainst).toEqual({ qty: 1_000, amount: 25 });

      // That confirmation IS the double reading, taken through another transport.
      expect(out.readings[0]!.recheck).toBe(25);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "finishes in the browser when the endpoint refuses a request made outside the page",
    async () => {
      const out = await probe("/guarded-endpoint");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      // The endpoint answered the PAGE, so it is still where the numbers come
      // from — but it would not answer us, so nothing was replayed and every
      // volume was driven and screenshotted.
      expect(out.strategy).toBe("endpoint");
      expect(out.evidence.every((e) => e.kind === "screenshot")).toBe(true);
      expect(out.readings.map((r) => r.cost)).toEqual([25, 25, 200]);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "replays a cached spec without re-discovering anything",
    async () => {
      const first = await probe("/slider");
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await probeCalculator({
        url: `${base}/slider`,
        quantities: QUANTITIES,
        spec: first.spec,
        timeoutMs: PROBE_BUDGET_MS,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.readings.map((r) => r.cost)).toEqual([25, 25, 200]);
      expect(second.spec.control.selector).toBe(first.spec.control.selector);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "drops the whole run when the total falls as the volume rises",
    async () => {
      const out = await probe("/descending");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const verdict = validateProbeSeries(out.readings);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.reason).toBe("non_monotonic");
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "skips entirely when the control's unit resolves to nothing we know",
    async () => {
      const out = await probe("/unknown-unit");
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toBe("unit_unresolved");
      // A page we can see but not name is exactly what the heal step is for.
      expect(out.prunedHtml?.length ?? 0).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "answers a consent banner with its own button, then measures",
    async () => {
      const out = await probe("/consent");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.readings.map((r) => r.cost)).toEqual([25, 25, 200]);
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "drops the run when the same volume answers differently the second time",
    async () => {
      const out = await probe("/flaky");
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const verdict = validateProbeSeries(out.readings);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.reason).toBe("reread_mismatch");
    },
    TIMEOUT,
  );

  it.skipIf(!hasBrowser)(
    "refuses a page that isn't there rather than reporting an empty measurement",
    async () => {
      const out = await probe("/nope");
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.reason).toBe("refused");
    },
    TIMEOUT,
  );
});
