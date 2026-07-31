/// <reference lib="dom" />
// page.evaluate() callbacks below run in the browser context (document/window).
// The root tsconfig is ES2022 only, so reference the DOM lib explicitly.
//
// Pricing Intelligence P4 — MEASURE what a `dynamic` (calculator) pricing page
// costs at the reference volumes, by using the competitor's own public
// calculator the way a prospect would: move the quantity control, wait, read the
// total, screenshot what was on screen when we read it.
//
// Collection doctrine, unchanged and non-negotiable here:
//   · robots.txt is honoured before the first request, the UA names the bot
//   · only VISIBLE, public controls are touched — a consent banner is answered
//     with its own visible button, exactly as a person would
//   · a captcha, a login wall or a paywall is a REFUSAL: abandon, log, never
//     work around it
//   · human pacing between interactions, one probe per competitor per day
//     (enforced by the caller's dedup key)
//
// And the rule the whole phase turns on: a failed probe writes ZERO points. Not a
// partial series, not an extrapolation, not "the last value we managed to read".
// Every judgement about whether a reading is believable is code, in
// @outrival/shared (validateProbeSeries) and in the pure modules next door.

import { chromium, type Browser, type Page, type Response } from "playwright";
import {
  resolveMeterUnit,
  type CalculatorSpec,
  type ProbeReading,
} from "@outrival/shared";
import { browserLaunchOptions } from "../../lib/proxy";
import { realisticHeaders, OUTRIVAL_UA } from "../../lib/fingerprint";
import { isCloudflareChallenge } from "../../lib/block-detection";
import { pruneHtmlForSelectors } from "../../lib/prune-html";
import { isAllowed, getCrawlDelayMs } from "../../lib/robots";
import { awaitDomainSlot } from "../../lib/rate-limit";
import { pickControl, reachableQuantities, type ControlCandidate, type PickedControl } from "./controls";
import { pickTotal, parseTotal, readsAsYearly, type TotalCandidate } from "./readings";
import { findPricePath, readPricePath, type CapturedJson, type PricePath } from "./endpoint";

/** The plan a measured point is filed under when the calculator names none. */
export const PROBE_PLAN_NAME = "Usage calculator";

const DEFAULT_TIMEOUT_MS = Number(process.env.PRICING_PROBE_TIMEOUT_MS ?? 90_000);
/** Every click and every value change counts. A calculator needs a handful; a
 * page that needs dozens is a page we are lost on. */
const MAX_INTERACTIONS = Number(process.env.PRICING_PROBE_MAX_INTERACTIONS ?? 15);
/** Bounded wait for the total to settle after a control moves. */
const settlePollMs = () => Number(process.env.PRICING_PROBE_SETTLE_POLL_MS ?? 250);
const settleMaxMs = () => Number(process.env.PRICING_PROBE_SETTLE_MAX_MS ?? 5_000);
/** Floor on how long "settled" takes to conclude. Two equal samples are NOT
 * enough on their own: right after an interaction the page is still showing the
 * OLD total, so a fast poller sees the old value twice and calls it settled —
 * reading the answer to the previous question. Debounced recompute (200-500ms) is
 * the norm on calculators, so the check only starts counting past this floor. */
const settleMinMs = () => Number(process.env.PRICING_PROBE_SETTLE_MIN_MS ?? 700);
/** Human pacing between interactions, randomised inside this band. Tunable like
 * the crawl gap (SCRAPE_MIN_DOMAIN_GAP_MS) so tests can drive a local fixture at
 * full speed without the doctrine's pace becoming a hard-coded 30s per run.
 * Read per CALL, not at module load: an env var set by an importer lands after
 * this module was evaluated, so a load-time read would silently ignore it. */
const paceMinMs = () => Number(process.env.PRICING_PROBE_PACE_MIN_MS ?? 600);
const paceMaxMs = () => Number(process.env.PRICING_PROBE_PACE_MAX_MS ?? 1_600);

export type ProbeFailure =
  | "robots_disallowed"
  | "refused" // block / challenge / non-2xx
  | "login_wall"
  | "no_controls"
  | "unit_unresolved"
  | "no_total"
  | "total_not_monthly"
  | "volumes_out_of_range"
  | "spec_stale"
  | "timeout"
  | "error";

export interface ProbeShot {
  qty: number;
  png: Buffer;
}

export interface ProbeSuccess {
  ok: true;
  /** Where each total came from: the page's own pricing XHR, or the DOM. */
  strategy: "endpoint" | "ui";
  unit: string;
  planName: string;
  currency: string;
  readings: ProbeReading[];
  shots: ProbeShot[];
  /** The recipe to cache, so the next probe skips discovery entirely. */
  spec: CalculatorSpec;
  finalUrl: string;
}

export interface ProbeRefusal {
  ok: false;
  reason: ProbeFailure;
  detail?: string;
  /**
   * Set when discovery failed on a page that IS a calculator: the pruned
   * skeleton the AI heal step turns into a spec. Populated only for the failures
   * a better selector could fix (never for a refusal or a robots Disallow —
   * healing those would just be a second attempt at a closed door).
   */
  prunedHtml?: string;
}

export type ProbeOutcome = ProbeSuccess | ProbeRefusal;

export interface ProbeOptions {
  url: string;
  /** Volumes to measure, in the meter the control turns out to move. */
  quantities: number[];
  /** A cached recipe from a previous probe of this competitor, if any. */
  spec?: CalculatorSpec | null;
  timeoutMs?: number;
}

/**
 * Drive one calculator and come back with what it charged.
 *
 * Never throws: every exit is a typed outcome, because the caller's contract is
 * that a probe failure leaves the pricing pipeline exactly as it was.
 */
export async function probeCalculator(options: ProbeOptions): Promise<ProbeOutcome> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Collection doctrine: ask permission before knocking, then queue politely
  // behind any other request this fleet has scheduled for the domain.
  if (!(await isAllowed(options.url))) return { ok: false, reason: "robots_disallowed" };
  await awaitDomainSlot(options.url, await getCrawlDelayMs(options.url));

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch(browserLaunchOptions("direct"));
    const context = await browser.newContext({
      userAgent: OUTRIVAL_UA,
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: realisticHeaders(),
    });
    try {
      const page = await context.newPage();
      const calls: CapturedJson[] = [];
      page.on("response", (response) => {
        void captureJson(response, calls);
      });
      return await drive(page, calls, options, deadline);
    } finally {
      await context.close().catch(() => {});
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return {
      ok: false,
      reason: name === "TimeoutError" ? "timeout" : "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function captureJson(response: Response, calls: CapturedJson[]): Promise<void> {
  try {
    const type = response.request().resourceType();
    if (type !== "xhr" && type !== "fetch") return;
    if (!(response.headers()["content-type"] ?? "").includes("json")) return;
    const raw = await response.text();
    if (raw.length > 200_000) return;
    calls.push({ url: response.url(), body: JSON.parse(raw) });
  } catch {
    // One unreadable response never costs the probe.
  }
}

async function drive(
  page: Page,
  calls: CapturedJson[],
  options: ProbeOptions,
  deadline: number,
): Promise<ProbeOutcome> {
  let interactions = 0;
  const spend = (): boolean => ++interactions <= MAX_INTERACTIONS;
  const outOfTime = (): boolean => Date.now() > deadline;

  const response = await page.goto(options.url, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(5_000, Math.min(30_000, deadline - Date.now())),
  });
  const status = response?.status() ?? 0;
  if (status === 0 || status >= 400) {
    return { ok: false, reason: "refused", detail: `http_${status}` };
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  const html = await page.content();
  if (isCloudflareChallenge(html)) return { ok: false, reason: "refused", detail: "challenge" };

  // A consent banner is answered with the button it puts on screen. Nothing is
  // dismissed by deleting nodes or setting cookies ourselves: that would be us
  // deciding on the visitor's behalf, and it is exactly the kind of "work around
  // the page" the doctrine rules out.
  if (spend()) await acceptConsent(page);

  if (await looksGated(page)) return { ok: false, reason: "login_wall" };

  // ── Control: cached recipe first, heuristics second ───────────────────────
  const cached = options.spec ? await resolveCachedControl(page, options.spec) : null;
  let control = cached;
  if (!control) {
    const candidates = await inventoryControls(page);
    const picked = pickControl(candidates);
    if (!picked.ok) {
      return {
        ok: false,
        reason: picked.reason,
        // A page with controls we can see but cannot name is exactly what the
        // heal step is for; a page with no controls at all is not.
        prunedHtml: picked.reason === "unit_unresolved" ? pruneHtmlForSelectors(html) : undefined,
        detail: `${candidates.length} candidate control(s)`,
      };
    }
    control = picked.control;
  }

  const quantities = reachableQuantities(control, options.quantities);
  if (quantities.length === 0) {
    return {
      ok: false,
      reason: "volumes_out_of_range",
      detail: `control range ${control.min ?? "?"}–${control.max ?? "?"}`,
    };
  }

  // ── Total: proven by moving the control, never assumed ────────────────────
  // The discovery move does double duty. It finds the element that displays the
  // total, AND it proves the control is live: if nothing priced changed, this
  // page's slider does not drive this page's number, and every reading that
  // followed would have been the same figure repeated.
  const probeQty = quantities[0]!;
  const preferred = options.spec?.total.selector ?? null;
  // Move to the FAR end of the requested range, not to the neighbouring volume: a
  // rate card with a monthly minimum shows the same total at 1k and at 10k, so a
  // small move proves nothing and would be read as "this control drives nothing".
  // If the page happens to already sit at that end, the other extreme is tried
  // once — one extra interaction, and the difference between discovering the
  // total and abandoning a page we could have measured.
  const attempts = [
    quantities[quantities.length - 1]!,
    quantities[0]!,
    contrastingQty(control, quantities, quantities[0]!),
  ].filter((q, i, all) => all.indexOf(q) === i);

  let totalPick: ReturnType<typeof pickTotal> = { ok: false, reason: "no_total" };
  for (const attempt of attempts) {
    const before = await snapshotTexts(page, preferred);
    if (!spend()) return { ok: false, reason: "error", detail: "interaction budget" };
    if (!(await setControl(page, control, attempt))) {
      return { ok: false, reason: "spec_stale", detail: "control not settable" };
    }
    await settle(page, null);
    const after = await snapshotTexts(page, preferred);
    totalPick = pickTotal(mergeCandidates(before, after));
    // `total_not_monthly` is a verdict about the page, not a failed attempt:
    // moving the control again would reach the same annual figure.
    if (totalPick.ok || totalPick.reason === "total_not_monthly") break;
  }
  if (!totalPick.ok) {
    return {
      ok: false,
      reason: totalPick.reason,
      prunedHtml: totalPick.reason === "no_total" ? pruneHtmlForSelectors(await page.content()) : undefined,
    };
  }
  const totalSelector = totalPick.selector;

  // The page's own pricing XHR, anchored on the number it just displayed. When
  // found, later volumes are read from the JSON instead of re-parsing the DOM —
  // same interaction, same screenshot, a number that can't be mangled by a
  // formatter or caught mid-animation.
  const pricePath = findPricePath(calls, totalPick.amount);

  // ── Measure ───────────────────────────────────────────────────────────────
  const readings: ProbeReading[] = [];
  const shots: ProbeShot[] = [];
  for (const qty of quantities) {
    if (outOfTime()) return { ok: false, reason: "timeout", detail: `after ${readings.length} readings` };
    if (!spend()) break;
    await pace();
    if (!(await setControl(page, control, qty))) {
      return { ok: false, reason: "spec_stale", detail: `control refused ${qty}` };
    }
    await settle(page, totalSelector);

    // Proof first: the screenshot has to show the state the number was read in.
    const png = await clipShot(page, control.selector, totalSelector);
    const reading = await readAt(page, totalSelector, calls, pricePath);
    if (!reading) {
      return { ok: false, reason: "no_total", detail: `unreadable at ${qty}` };
    }
    if (png) shots.push({ qty, png });
    readings.push({ qty, cost: reading.cost, currency: reading.currency });
  }
  if (readings.length === 0) {
    return { ok: false, reason: "volumes_out_of_range", detail: "no volume measured" };
  }

  // ── Double reading ────────────────────────────────────────────────────────
  // Move away, come back, ask the same question again. A calculator that answers
  // differently the second time (a stale render, a debounce we outran, an A/B
  // bucket that flipped) is one whose first answer we cannot quote either — and
  // the caller drops the entire run on a mismatch.
  const recheckQty = readings[0]!.qty;
  if (spend() && !outOfTime()) {
    await pace();
    await setControl(page, control, contrastingQty(control, quantities, recheckQty));
    await settle(page, totalSelector);
    if (spend()) {
      await pace();
      await setControl(page, control, recheckQty);
      await settle(page, totalSelector);
      const again = await readAt(page, totalSelector, calls, pricePath);
      readings[0] = { ...readings[0]!, recheck: again?.cost ?? null };
    }
  }

  return {
    ok: true,
    strategy: pricePath ? "endpoint" : "ui",
    unit: control.unit,
    planName: options.spec?.control.planName ?? PROBE_PLAN_NAME,
    currency: readings[0]!.currency,
    readings,
    shots,
    spec: {
      version: 1,
      control: {
        selector: control.selector,
        kind: control.kind,
        unit: control.unit,
        planName: options.spec?.control.planName ?? null,
      },
      total: { selector: totalSelector },
    },
    finalUrl: page.url(),
  };
}

// ---------------------------------------------------------------------------
// Page-side operations
// ---------------------------------------------------------------------------

const CONSENT_LABEL =
  /^(accept|accept all|allow all|allow|agree|i agree|got it|ok|okay|continue|understood|tout accepter|accepter|j'accepte|alles akzeptieren|akzeptieren|zustimmen|aceptar|accetta|accepteren)\b/i;

/** Click a consent banner's own accept button, once, if one is visible. */
async function acceptConsent(page: Page): Promise<void> {
  await page
    .evaluate((source) => {
      const re = new RegExp(source, "i");
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]'),
      );
      for (const el of controls) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (getComputedStyle(el).visibility === "hidden") continue;
        const label = (el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!label || label.length > 40 || !re.test(label)) continue;
        el.click();
        return true;
      }
      return false;
    }, CONSENT_LABEL.source)
    .catch(() => false);
  await page.waitForTimeout(500);
}

const GATE_COPY =
  /(sign|log)\s?in to (see|view|access|continue)|create an account to (see|view)|subscribe to (read|continue)|verify you are human|are you a robot/i;

/** A page asking us to authenticate is a page refusing us. We stop there. */
async function looksGated(page: Page): Promise<boolean> {
  return page
    .evaluate(
      ({ source }) => {
        const text = document.body?.innerText ?? "";
        if (new RegExp(source, "i").test(text)) return true;
        // A password field on a pricing page means the pricing is behind a login.
        return document.querySelector('input[type="password"]') != null;
      },
      { source: GATE_COPY.source },
    )
    .catch(() => false);
}

/** Every quantity-ish control on the page, described well enough to rank. */
async function inventoryControls(page: Page): Promise<ControlCandidate[]> {
  return page
    .evaluate(() => {
      // --- in-page helpers (nothing from the module scope exists here) ---
      const cssPath = (el: Element): string => {
        if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.nodeType === 1 && parts.length < 8) {
          if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
            parts.unshift(`#${node.id}`);
            break;
          }
          const parent: Element | null = node.parentElement;
          if (!parent) {
            parts.unshift(node.tagName.toLowerCase());
            break;
          }
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
          const index = siblings.indexOf(node) + 1;
          parts.unshift(
            siblings.length > 1
              ? `${node.tagName.toLowerCase()}:nth-of-type(${index})`
              : node.tagName.toLowerCase(),
          );
          node = parent;
        }
        return parts.join(" > ");
      };

      const PRICE_RE = /[€$£¥]\s?\d|\d\s?[€$£¥]|\b(USD|EUR|GBP)\b/;
      const priceDistance = (el: Element): number => {
        // Walk up; at each level look for a price in the subtree. The number of
        // levels climbed is the distance.
        let node: Element | null = el;
        for (let hops = 0; node && hops < 20; hops++) {
          const text = (node as HTMLElement).innerText ?? node.textContent ?? "";
          if (PRICE_RE.test(text)) return hops;
          node = node.parentElement;
        }
        return 99;
      };

      const labelOf = (el: HTMLElement): string => {
        const bits: string[] = [];
        const push = (v: string | null | undefined) => {
          if (v && v.trim()) bits.push(v.trim());
        };
        push(el.getAttribute("aria-label"));
        push(el.getAttribute("name"));
        push(el.getAttribute("id"));
        push(el.getAttribute("placeholder"));
        push(el.getAttribute("data-unit"));
        const labelled = el.getAttribute("aria-labelledby");
        if (labelled) {
          for (const id of labelled.split(/\s+/)) {
            push(document.getElementById(id)?.innerText);
          }
        }
        if (el.id) {
          push(document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)?.innerText);
        }
        push(el.closest("label")?.innerText);
        // The wrapper's own copy — a slider is usually captioned by its container
        // ("Monthly tracked users") rather than by a <label>.
        const wrapper = el.parentElement;
        if (wrapper) push((wrapper.innerText ?? "").slice(0, 160));
        const section = el.closest("fieldset, section, div[class*='calc'], div[class*='slider']");
        if (section) push((section as HTMLElement).innerText?.slice(0, 200));
        return bits.join(" · ").slice(0, 500);
      };

      const num = (v: string | null): number | null => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      const out: {
        selector: string;
        kind: "range" | "number" | "select";
        label: string;
        min: number | null;
        max: number | null;
        step: number | null;
        options: number[];
        priceDistance: number;
      }[] = [];

      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="range"], input[type="number"]'),
      );
      for (const el of inputs) {
        const rect = el.getBoundingClientRect();
        // A control nobody can see is a control nobody uses. (Sliders are often
        // styled with an invisible native input over a custom track, so height 0
        // alone is not disqualifying — only display:none / hidden is.)
        if (el.disabled) continue;
        if (getComputedStyle(el).display === "none") continue;
        if (rect.width < 1 && rect.height < 1) continue;
        out.push({
          selector: cssPath(el),
          kind: el.type === "range" ? "range" : "number",
          label: labelOf(el),
          min: num(el.getAttribute("min")),
          max: num(el.getAttribute("max")),
          step: num(el.getAttribute("step")),
          options: [],
          priceDistance: priceDistance(el),
        });
      }

      for (const el of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
        if (el.disabled) continue;
        if (getComputedStyle(el).display === "none") continue;
        const options = Array.from(el.options)
          .map((o) => Number(String(o.value).replace(/[\s,_]/g, "")))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (options.length === 0) continue;
        out.push({
          selector: cssPath(el),
          kind: "select",
          label: labelOf(el),
          min: Math.min(...options),
          max: Math.max(...options),
          step: null,
          options,
          priceDistance: priceDistance(el),
        });
      }

      return out;
    })
    .catch(() => [] as ControlCandidate[]);
}

/**
 * Re-resolve a cached recipe against the live page. A spec whose control has
 * vanished, whose label now names a DIFFERENT meter, or whose total no longer
 * exists is not repaired here — it is dropped, and discovery runs again. A cached
 * selector that still matches something is not evidence that it still matches the
 * right thing.
 */
async function resolveCachedControl(page: Page, spec: CalculatorSpec): Promise<PickedControl | null> {
  const live = await page
    .evaluate(
      ({ selector }) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const input = el as HTMLInputElement | HTMLSelectElement;
        const label = [
          el.getAttribute("aria-label"),
          el.getAttribute("name"),
          el.getAttribute("id"),
          (el.parentElement?.innerText ?? "").slice(0, 160),
        ]
          .filter(Boolean)
          .join(" · ");
        const options =
          el.tagName === "SELECT"
            ? Array.from((el as HTMLSelectElement).options)
                .map((o) => Number(String(o.value).replace(/[\s,_]/g, "")))
                .filter((n) => Number.isFinite(n) && n > 0)
            : [];
        const n = (v: string | null) => {
          if (v == null || v === "") return null;
          const parsed = Number(v);
          return Number.isFinite(parsed) ? parsed : null;
        };
        return {
          label,
          options,
          min: n(input.getAttribute("min")),
          max: n(input.getAttribute("max")),
          step: n(input.getAttribute("step")),
        };
      },
      { selector: spec.control.selector },
    )
    .catch(() => null);
  if (!live) return null;

  // The meter the label names now must be the meter the spec was measured on.
  const meter = resolveMeterUnit(live.label);
  if (meter?.canonical && meter.unit !== spec.control.unit) return null;

  return {
    selector: spec.control.selector,
    kind: spec.control.kind,
    unit: spec.control.unit,
    min: live.min ?? null,
    max: live.max ?? (live.options.length ? Math.max(...live.options) : null),
    step: live.step ?? null,
    options: live.options,
  };
}

/** Set the control's value the way the page's own framework expects. */
async function setControl(page: Page, control: PickedControl, qty: number): Promise<boolean> {
  return page
    .evaluate(
      ({ selector, value, kind }) => {
        const el = document.querySelector(selector) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) return false;
        const proto =
          kind === "select" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
        // Assigning `.value` directly is swallowed by React's synthetic-event
        // layer (it caches the last value it wrote); going through the native
        // setter is what makes a controlled input actually re-render.
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, String(value));
        else (el as HTMLInputElement).value = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return String((el as HTMLInputElement).value) === String(value);
      },
      { selector: control.selector, value: qty, kind: control.kind },
    )
    .catch(() => false);
}

/** Bounded wait for the total to stop moving (a debounce, an XHR, a tween). */
async function settle(page: Page, totalSelector: string | null): Promise<void> {
  const poll = settlePollMs();
  const startedAt = Date.now();
  const floor = settleMinMs();
  const deadline = startedAt + settleMaxMs();
  let last: string | null = null;
  while (Date.now() < deadline) {
    const current = await page
      .evaluate(
        ({ selector }) =>
          selector
            ? (document.querySelector<HTMLElement>(selector)?.innerText ?? "")
            : (document.body?.innerText ?? "").slice(0, 5_000),
        { selector: totalSelector },
      )
      .catch(() => null);
    if (current != null && current === last && Date.now() - startedAt >= floor) return;
    last = current;
    await page.waitForTimeout(poll);
  }
}

/** Every leaf-ish element's text, keyed by selector — the before/after of a move. */
async function snapshotTexts(
  page: Page,
  preferredSelector: string | null,
): Promise<Map<string, { text: string; childCount: number; context: string }>> {
  const rows = await page
    .evaluate(
      ({ preferred }) => {
        const cssPath = (el: Element): string => {
          if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
          const parts: string[] = [];
          let node: Element | null = el;
          while (node && node.nodeType === 1 && parts.length < 8) {
            if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
              parts.unshift(`#${node.id}`);
              break;
            }
            const parent: Element | null = node.parentElement;
            if (!parent) {
              parts.unshift(node.tagName.toLowerCase());
              break;
            }
            const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
            const index = siblings.indexOf(node) + 1;
            parts.unshift(
              siblings.length > 1
                ? `${node.tagName.toLowerCase()}:nth-of-type(${index})`
                : node.tagName.toLowerCase(),
            );
            node = parent;
          }
          return parts.join(" > ");
        };

        const PRICE_RE = /[€$£¥]\s?\d|\d[\d.,\s]*\s?[€$£¥]|\b(USD|EUR|GBP|CHF)\b\s?\d/;
        const out: { selector: string; text: string; childCount: number; context: string }[] = [];
        const seen = new Set<string>();
        const consider = (el: Element) => {
          const text = ((el as HTMLElement).innerText ?? el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim();
          if (!text || text.length > 200 || !PRICE_RE.test(text)) return;
          const selector = cssPath(el);
          if (seen.has(selector)) return;
          seen.add(selector);
          const parentText = ((el.parentElement as HTMLElement | null)?.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240);
          out.push({ selector, text, childCount: el.children.length, context: parentText });
        };

        if (preferred) {
          const el = document.querySelector(preferred);
          if (el) consider(el);
        }
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          if (el.children.length > 3) continue; // leaf-ish only
          consider(el);
          if (out.length > 400) break;
        }
        return out;
      },
      { preferred: preferredSelector },
    )
    .catch(() => [] as { selector: string; text: string; childCount: number; context: string }[]);

  return new Map(rows.map((r) => [r.selector, { text: r.text, childCount: r.childCount, context: r.context }]));
}

/** Elements present on both sides of the move, as total candidates. */
function mergeCandidates(
  before: Map<string, { text: string; childCount: number; context: string }>,
  after: Map<string, { text: string; childCount: number; context: string }>,
): TotalCandidate[] {
  const out: TotalCandidate[] = [];
  for (const [selector, now] of after) {
    const then = before.get(selector);
    if (!then) continue;
    out.push({
      selector,
      before: then.text,
      after: now.text,
      childCount: now.childCount,
      context: now.context,
    });
  }
  return out;
}

/** The current total: from the page's pricing XHR when we found one, else the DOM. */
async function readAt(
  page: Page,
  totalSelector: string,
  calls: CapturedJson[],
  pricePath: PricePath | null,
): Promise<{ cost: number; currency: string } | null> {
  const dom = await page
    .evaluate(
      ({ selector }) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return null;
        return {
          text: (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim(),
          context: ((el.parentElement as HTMLElement | null)?.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240),
        };
      },
      { selector: totalSelector },
    )
    .catch(() => null);
  if (!dom) return null;

  const parsed = parseTotal(dom.text);
  // The currency always comes from what is on screen — a JSON number carries no
  // currency, and inferring one would be inventing the most important half.
  if (!parsed) return null;
  if (readsAsYearly(`${dom.context} ${dom.text}`)) return null;

  if (pricePath) {
    const fromJson = readPricePath(calls, pricePath);
    if (fromJson != null && fromJson > 0) return { cost: fromJson, currency: parsed.currency };
  }
  return { cost: parsed.amount, currency: parsed.currency };
}

/** The calculator and its total, cropped — the proof for one measured point. */
async function clipShot(
  page: Page,
  controlSelector: string,
  totalSelector: string,
): Promise<Buffer | null> {
  const box = await page
    .evaluate(
      ({ a, b }) => {
        const rects = [a, b]
          .map((s) => document.querySelector(s))
          .filter((el): el is Element => el != null)
          .map((el) => el.getBoundingClientRect());
        if (rects.length === 0) return null;
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        return {
          x: left + window.scrollX,
          y: top + window.scrollY,
          width: right - left,
          height: bottom - top,
        };
      },
      { a: controlSelector, b: totalSelector },
    )
    .catch(() => null);

  const PAD = 32;
  try {
    if (!box || box.width <= 0 || box.height <= 0) {
      return await page.screenshot({ type: "png" });
    }
    return await page.screenshot({
      type: "png",
      clip: {
        x: Math.max(0, box.x - PAD),
        y: Math.max(0, box.y - PAD),
        width: Math.min(4_000, box.width + PAD * 2),
        height: Math.min(4_000, box.height + PAD * 2),
      },
    });
  } catch {
    return null;
  }
}

/**
 * A quantity that is DIFFERENT from `from` and still inside the control's range
 * — what the discovery move and the double reading both need. Prefers another
 * requested volume (already proven settable), then the control's own bounds.
 */
export function contrastingQty(
  control: Pick<PickedControl, "min" | "max" | "options">,
  quantities: number[],
  from: number,
): number {
  const other = quantities.find((q) => q !== from);
  if (other != null) return other;
  if (control.options.length > 0) {
    const alt = control.options.find((o) => o !== from);
    if (alt != null) return alt;
  }
  if (control.max != null && Number.isFinite(control.max) && control.max !== from) return control.max;
  if (control.min != null && Number.isFinite(control.min) && control.min !== from) return control.min;
  return from * 2;
}

/** Human pacing: a person reads the new number before dragging again. */
async function pace(): Promise<void> {
  const min = paceMinMs();
  const span = Math.max(0, paceMaxMs() - min);
  const ms = min + Math.floor(Math.random() * (span + 1));
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}
