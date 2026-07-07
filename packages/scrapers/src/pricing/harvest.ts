import * as cheerio from "cheerio";
import type { BillingPeriodValue } from "@outrival/shared";

// cheerio 1.x doesn't re-export its node type; derive an element selection type
// from the API surface (`load().root().find()` → Cheerio<Element>) so we avoid
// importing the transitive `domhandler` dependency directly.
type CheerioSel = ReturnType<ReturnType<ReturnType<typeof cheerio.load>["root"]>["find"]>;

// L2 deterministic price-harvest floor (docs/pricing-coverage-2026.md, Part II).
// AI-free. Runs ONLY when the staged extractor (structured → cache → heal → AI)
// returned no plans yet the page visibly carries prices — the SaaS-tuned AI floor
// silently returns [] on "from €X" cards, configurator defaults, and non-tabular
// hosting/e-commerce grids. The harvest guarantees the invariant: **if prices are
// visible, we never show zero tiers**. It is a floor, not a replacement — a page
// the AI parses cleanly never reaches it. Competitor-agnostic: structure + regex
// only, no domain/vertical branch.

export interface HarvestedPlan {
  plan_name: string;
  price: number | null;
  currency: string;
  billing_period: BillingPeriodValue;
  unit?: string | null;
  included_quantity?: number | null;
}

export interface PricingHarvest {
  plans: HarvestedPlan[];
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
};

// Symbol + number, either order. The number allows spaces (FR thousands) and both
// separators; `parseAmount` normalizes it. Non-global: we test/exec per element.
const PRICE_RE =
  /([€$£¥])\s?(\d[\d.,\s]*\d|\d)|(\d[\d.,\s]*\d|\d)\s?([€$£¥])/;

// A tight price element is short — a big container's text ("€29/mo Everything in
// Pro plus…") would attach the price to the wrong, sprawling label.
const MAX_PRICE_EL_TEXT = 48;
const MAX_LABEL_TEXT = 60;
const MAX_PLANS = 12;
const MAX_LABEL_ANCESTORS = 4;
// Above this an "amount" is almost certainly an id / phone / year, not a price.
const MAX_SANE_PRICE = 1_000_000;

// Title-ish class tokens for a plan/product card heading when there's no h1-h6.
const TITLE_CLASS = /(title|name|plan|product|package|tier|heading|card__?title)/i;
const PRICE_CLASS = /(price|amount|cost|pricing|montant|tarif)/i;

// Period / unit vocabulary (EN + FR). Order matters: usage units win over a bare
// period so "$0.10 / GB" is `usage`, not `monthly`.
const USAGE_UNIT =
  /\/\s?(gb|go|tb|to|request|req|api\s?call|call|lookup|credit|message|token|email|sms|minute|core|vcpu|slot|player)\b/i;
const YEARLY = /\/\s?(yr|year|ann?[ée]e?|an)\b|per\s+year|\byearly\b|\bannual(ly)?\b|\/\s?an\b|par\s+an\b/i;
const MONTHLY = /\/\s?(mo|month|mois)\b|per\s+month|\bmonthly\b|\/\s?mois\b|par\s+mois\b/i;
const ONE_TIME = /\bone[-\s]?time\b|\blifetime\b|\bune\s+fois\b|\b[àa]\s+vie\b|\bsetup\s+fee\b/i;
// Per-seat/user is a subscription with a unit, not metered usage.
const PER_SEAT = /\/\s?(user|seat|utilisateur|si[èe]ge|member)\b|per\s+(user|seat)\b/i;

interface Hit {
  amount: number;
  currency: string;
  period: BillingPeriodValue;
  unit: string | null;
  label: string | null;
}

/**
 * Extract a best-effort set of pricing plans from raw HTML with no AI. When plan
 * cards carry a title, emit one row per titled card (`plan_name = card title`) —
 * this is what produces the "N product-line rows" for catalog sites once L3 stamps
 * a product-line prefix upstream. When no titles resolve, fall back to the entry
 * price + range (`From` / `Up to`) so the tab still shows the price band.
 */
export function harvestPricing(html: string): PricingHarvest {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg").remove();

  // Leaf-most price elements: an element whose (short) text carries a price and
  // which contains no other matched price element — so a card and its inner
  // `<span>€29</span>` don't both count the same amount.
  const matched = $("body *")
    .toArray()
    .filter((el) => {
      const t = $(el).text();
      return t.length <= MAX_PRICE_EL_TEXT && PRICE_RE.test(t);
    });
  const leaves = matched.filter(
    (el) => !matched.some((other) => other !== el && $.contains(el, other)),
  );

  const hits: Hit[] = [];
  for (const el of leaves) {
    const $el = $(el);
    const m = matchPrice($el.text());
    if (!m) continue;
    // Period/unit read from the price element plus its immediate parent (the "/mo"
    // is often a sibling of the amount, e.g. `<b>29</b><small>/mo</small>`).
    const ctx = `${$el.text()} ${$el.parent().text().slice(0, 120)}`;
    const { period, unit } = detectPeriod(ctx);
    hits.push({
      amount: m.amount,
      currency: m.currency,
      period,
      unit,
      label: findLabel($, $el),
    });
  }

  const cleaned = dedupe(hits.filter((h) => h.amount >= 0 && h.amount < MAX_SANE_PRICE));
  if (cleaned.length === 0) return { plans: [] };

  // Real plan cards carry DISTINCT titles (Starter/Pro/Business). A label repeated
  // across several prices is a shared section heading ("Affordable Pricing"), not a
  // per-plan name — those collapse to the price band below instead of N identical rows.
  const labeled = cleaned.filter((h) => h.label);
  const distinctLabels = new Set(labeled.map((h) => (h.label as string).toLowerCase()));
  if (labeled.length > 0 && distinctLabels.size === labeled.length) {
    return {
      plans: labeled
        .sort((a, b) => a.amount - b.amount)
        .slice(0, MAX_PLANS)
        .map((h) => ({
          plan_name: h.label as string,
          price: h.amount,
          currency: h.currency,
          billing_period: h.period,
          unit: h.unit,
          included_quantity: null,
        })),
    };
  }

  // No titles resolved → surface the band so the user still sees a price.
  const sorted = [...cleaned].sort((a, b) => a.amount - b.amount);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const plans: HarvestedPlan[] = [
    {
      plan_name: "From",
      price: min.amount,
      currency: min.currency,
      billing_period: min.period,
      unit: min.unit,
      included_quantity: null,
    },
  ];
  if (max.amount !== min.amount) {
    plans.push({
      plan_name: "Up to",
      price: max.amount,
      currency: max.currency,
      billing_period: max.period,
      unit: max.unit,
      included_quantity: null,
    });
  }
  return { plans };
}

/** First price in a string → normalized amount + ISO currency, or null. */
function matchPrice(text: string): { amount: number; currency: string } | null {
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  const symbol = m[1] ?? m[4] ?? "$";
  const raw = m[2] ?? m[3] ?? "";
  const amount = parseAmount(raw);
  if (amount === null) return null;
  return { amount, currency: CURRENCY_BY_SYMBOL[symbol] ?? "USD" };
}

/**
 * Normalize a scraped number string to a float, handling FR/EN separators:
 * "2,99" → 2.99, "1,299.00" → 1299, "1 299,00" → 1299, "29" → 29. The rightmost
 * of `.`/`,` is the decimal separator; the other is thousands.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // Only commas: "2,99" → decimal; "1,299" → thousands.
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.split(",").join("");
  } else if (lastDot >= 0) {
    // Only dots: treat "1.299" (3 trailing digits, no decimal intent) as thousands.
    s = /\.\d{3}$/.test(s) && !/\.\d{1,2}$/.test(s) ? s.split(".").join("") : s;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Map period/unit vocabulary near a price to a billing_period + optional unit. */
function detectPeriod(ctx: string): { period: BillingPeriodValue; unit: string | null } {
  const usage = USAGE_UNIT.exec(ctx);
  if (usage) return { period: "usage", unit: usage[1]!.toLowerCase() };
  const seat = PER_SEAT.exec(ctx);
  if (ONE_TIME.test(ctx)) return { period: "one_time", unit: null };
  if (YEARLY.test(ctx)) return { period: "yearly", unit: seat ? "seat" : null };
  if (MONTHLY.test(ctx) || seat) return { period: "monthly", unit: seat ? "seat" : null };
  // No period token → default to monthly (the dominant subscription case). A floor
  // guess the user can correct; better than dropping a visible price.
  return { period: "monthly", unit: null };
}

/**
 * Walk up from a price element to find its card title: the nearest ancestor's
 * heading (h1-h6) or a title-classed element whose text is short and not itself a
 * price. Null when nothing plausible is within a few levels.
 */
function findLabel($: cheerio.CheerioAPI, $priceEl: CheerioSel): string | null {
  let $node = $priceEl;
  for (let depth = 0; depth < MAX_LABEL_ANCESTORS; depth++) {
    const $parent = $node.parent();
    if ($parent.length === 0) break;
    let found: string | null = null;
    $parent.find("h1, h2, h3, h4, h5, h6, [class]").each((_, el) => {
      if (found) return;
      const $el = $(el);
      const isHeading = /^h[1-6]$/i.test((el as { tagName?: string }).tagName ?? "");
      const cls = $el.attr("class") ?? "";
      if (!isHeading && !(TITLE_CLASS.test(cls) && !PRICE_CLASS.test(cls))) return;
      const text = $el.text().trim().replace(/\s+/g, " ");
      if (!text || text.length > MAX_LABEL_TEXT) return;
      if (PRICE_RE.test(text)) return; // the price node itself, not a title
      found = text;
    });
    if (found) return found;
    $node = $parent;
  }
  return null;
}

/** Collapse hits sharing (label, amount, period) — the same card seen twice. */
function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = `${(h.label ?? "").toLowerCase()}|${h.amount}|${h.period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
