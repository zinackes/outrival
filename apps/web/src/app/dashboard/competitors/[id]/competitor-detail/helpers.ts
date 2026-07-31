// Pure, JSX-free helpers shared across the competitor-detail tabs. No React, no
// app-local type coupling — safe to import from any tab module.

import {
  ALL_CONFIGURABLE_SOURCES,
  buildCoverage,
  sourceState,
  type DetectedTargets,
  type MonitorCoverageFields,
  type Plan,
  type SourceCoverage,
} from "@outrival/shared";

export function formatTierPrice(p: {
  price: number | null;
  currency: string;
  billing_period: string;
  // Dimensional pricing (2026 models). unit = what a usage/per-seat price applies to
  // ("API call", "credit", "seat"); includedQuantity = units bundled into the plan
  // (credit-pack size). See docs/pricing-coverage-2026.md.
  unit?: string | null;
  includedQuantity?: number | null;
}): string {
  // Quote-based tier (Enterprise / "Contact sales") — no public number.
  if (p.price === null) return "Custom";
  if (p.price === 0 && p.billing_period !== "usage") return "Free";
  const sym =
    p.currency === "USD" ? "$" : p.currency === "EUR" ? "€" : p.currency === "GBP" ? "£" : "";
  const amount = sym ? `${sym}${p.price}` : `${p.price} ${p.currency}`;
  // A usage rate is priced per unit, not per period: "$0.10 / API call".
  if (p.billing_period === "usage") return p.unit ? `${amount} / ${p.unit}` : `${amount} / use`;
  // A one-time bundle with a stated size (a credit pack): "$99 · 1,000 credits".
  if (p.billing_period === "one_time" && p.includedQuantity != null && p.unit) {
    const qty = p.includedQuantity.toLocaleString();
    return `${amount} · ${qty} ${p.unit}${p.includedQuantity === 1 ? "" : "s"}`;
  }
  const per =
    p.billing_period === "monthly" ? "/mo" : p.billing_period === "yearly" ? "/yr" : "";
  return `${amount}${per}`;
}

/**
 * The per-month reading of an annual tier: "≈ $16/mo billed annually", or null
 * when the tier isn't a priced yearly one.
 *
 * A `yearly` price is stored as the amount charged for a YEAR (the annual total),
 * which is the only reading the price ladder and the medians can compare — but
 * "$192/yr" is not how the pricing page phrased it, and not how a buyer thinks
 * about it. Showing the division alongside means the number on screen matches the
 * number on the competitor's site without the stored value having to.
 */
export function annualPerMonthLabel(p: {
  price: number | null;
  currency: string;
  billing_period: string;
}): string | null {
  if (p.billing_period !== "yearly" || p.price == null || p.price <= 0) return null;
  const perMonth = p.price / 12;
  const rounded = perMonth >= 10 ? Math.round(perMonth) : Math.round(perMonth * 100) / 100;
  const monthly = formatTierPrice({
    price: rounded,
    currency: p.currency,
    billing_period: "monthly",
  });
  return `≈ ${monthly} billed annually`;
}

// A captured customer logo carries a brand name (from <img alt>) and/or a resolved
// absolute image URL (`src`). Prefer rendering the real logo image — it reads far
// better than a text badge — and fall back to the name only when there's no usable
// image (no src, a non-absolute src, or the image failed to load).
export function isRenderableLogoSrc(value: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(value.trim());
}

export function logoLabel(value: string): string {
  const v = value.trim();
  if (!v || /^data:/i.test(v)) return "";
  const looksLikePath =
    /^(https?:|\/\/|\/|\.\.?\/)/i.test(v) ||
    /\.(png|jpe?g|svg|webp|gif|avif|ico)(\?|#|$)/i.test(v);
  if (!looksLikePath) return v; // already a brand name (alt text)
  const file = (v.split(/[?#]/)[0] ?? v).split("/").filter(Boolean).pop() ?? v;
  return file
    .replace(/\.(png|jpe?g|svg|webp|gif|avif|ico)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Seniority ordering (low→high) so a role list surfaces the senior bets first.
// Keys match the canonical buckets the ATS resolver emits (packages/scrapers jobs/ats).
export const SENIORITY_RANK: Record<string, number> = {
  executive: 8,
  lead: 7,
  principal: 6,
  staff: 5,
  senior: 4,
  mid: 3,
  junior: 2,
  intern: 1,
};

// Rank at/above which a role counts as a "senior+" bet (senior, staff, principal,
// lead, executive) — a leading indicator of a serious build.
export const SENIOR_PLUS_THRESHOLD = 4;

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// formatMoney / salaryLabel moved to @/lib/format-money: a component outside this
// route needs them, and a component may not import from an app route.

/**
 * This competitor's sources folded into coverage buckets.
 *
 * The rail computed this inline and nothing else could reach it, so the page header
 * had no way to say a competitor blocks us — the one place a widespread refusal
 * actually belongs. One definition, two readers, no chance of the header and the
 * rail disagreeing about the same monitors.
 */
export function competitorCoverage(
  monitors: MonitorCoverageFields[],
  plan: Plan,
  targets: DetectedTargets | null,
): SourceCoverage {
  const bySource = new Map(monitors.map((m) => [m.sourceType, m]));
  return buildCoverage(
    ALL_CONFIGURABLE_SOURCES.map((sourceType) => ({
      sourceType,
      state: sourceState({ sourceType, plan, monitor: bySource.get(sourceType) ?? null, targets }),
    })),
  );
}
