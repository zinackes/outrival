// Day-0 landscape quick wins (docs/post-onboarding-activation.md, Lever 3).
// Pure, deterministic rules over the first-scrape data — no AI, unit-testable.
// The aha moment is "I learned something about a competitor I didn't know";
// these cards deliver it minutes after onboarding, before any signal exists.

export interface InsightPricingRow {
  competitorId: string;
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
  hasTrial: boolean | null;
  trialDays: number | null;
}

export interface InsightHiringRow {
  competitorId: string;
  total: number;
  topDepartment: string | null;
}

export interface InsightReviewRow {
  competitorId: string;
  source: string;
  score: number;
  reviewCount: number;
}

export interface LandscapeInsight {
  kind: "pricing_gap" | "trial" | "hiring" | "reviews";
  text: string;
  competitorId: string | null;
}

const REVIEW_SOURCE_LABELS: Record<string, string> = {
  g2: "G2",
  capterra: "Capterra",
  appstore: "the App Store",
  playstore: "the Play Store",
  trustpilot: "Trustpilot",
  trustradius: "TrustRadius",
  gartner: "Gartner",
};

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

function fmtPrice(price: number, currency: string | null): string {
  const rounded = Number.isInteger(price) ? String(price) : price.toFixed(2);
  const sym = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : "$";
  return sym ? `${sym}${rounded}` : `${rounded} ${currency}`;
}

// Cheapest paid plan per competitor, monthly-first: monthly rows win; a
// competitor with only yearly/unlabelled pricing still gets a floor so the
// comparison degrades instead of vanishing.
function entryPlan(rows: InsightPricingRow[]): InsightPricingRow | null {
  const paid = rows.filter((r) => r.price != null && r.price > 0);
  if (paid.length === 0) return null;
  const monthly = paid.filter((r) => !r.billingPeriod || r.billingPeriod === "monthly");
  const pool = monthly.length > 0 ? monthly : paid;
  return pool.reduce((min, r) => ((r.price ?? 0) < (min.price ?? 0) ? r : min));
}

export function computeLandscapeInsights(input: {
  competitors: Array<{ id: string; name: string }>;
  pricing: InsightPricingRow[];
  selfPricing: InsightPricingRow[];
  hiring: InsightHiringRow[];
  reviews: InsightReviewRow[];
}): LandscapeInsight[] {
  const nameById = new Map(input.competitors.map((c) => [c.id, c.name]));
  const out: LandscapeInsight[] = [];

  // 1 — entry-plan gap vs the user's own pricing (the sharpest "did you know").
  const selfEntry = entryPlan(input.selfPricing);
  if (selfEntry?.price != null) {
    let best: { row: InsightPricingRow; pct: number } | null = null;
    for (const id of nameById.keys()) {
      const entry = entryPlan(input.pricing.filter((r) => r.competitorId === id));
      if (entry?.price == null) continue;
      // Only compare like currencies — a €49 vs $39 gap is noise, not insight.
      const sameCurrency =
        !entry.currency || !selfEntry.currency ||
        entry.currency.toUpperCase() === selfEntry.currency.toUpperCase();
      if (!sameCurrency) continue;
      const pct = Math.round(((entry.price - selfEntry.price) / selfEntry.price) * 100);
      if (Math.abs(pct) < 10) continue;
      if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { row: entry, pct };
    }
    if (best) {
      const name = nameById.get(best.row.competitorId) ?? "A competitor";
      const dir = best.pct > 0 ? "above" : "below";
      out.push({
        kind: "pricing_gap",
        competitorId: best.row.competitorId,
        text: `${name}'s entry plan is ${Math.abs(best.pct)}% ${dir} yours (${fmtPrice(best.row.price!, best.row.currency)} vs ${fmtPrice(selfEntry.price, selfEntry.currency)}/mo).`,
      });
    }
  }

  // 2 — free-trial posture (patch-33 trial facts).
  const trialRow = input.pricing
    .filter((r) => r.hasTrial === true && nameById.has(r.competitorId))
    .sort((a, b) => (b.trialDays ?? 0) - (a.trialDays ?? 0))[0];
  if (trialRow) {
    const name = nameById.get(trialRow.competitorId) ?? "A competitor";
    const trial = trialRow.trialDays ? `a ${trialRow.trialDays}-day free trial` : "a free trial";
    const selfHasTrial = input.selfPricing.some((r) => r.hasTrial === true);
    const contrast =
      input.selfPricing.length > 0 && !selfHasTrial ? " — you don't advertise one" : "";
    out.push({
      kind: "trial",
      competitorId: trialRow.competitorId,
      text: `${name} offers ${trial}${contrast}.`,
    });
  }

  // 3 — the most active hirer (≥3 open roles so tiny teams don't read as a spike).
  const topHirer = [...input.hiring]
    .filter((h) => h.total >= 3 && nameById.has(h.competitorId))
    .sort((a, b) => b.total - a.total)[0];
  if (topHirer) {
    const name = nameById.get(topHirer.competitorId) ?? "A competitor";
    const dept = topHirer.topDepartment ? ` (mostly ${topHirer.topDepartment})` : "";
    out.push({
      kind: "hiring",
      competitorId: topHirer.competitorId,
      text: `${name} has ${topHirer.total} open roles right now — the most active hirer you track${dept}.`,
    });
  }

  // 4 — the best-reviewed competitor (≥5 reviews so a single 5-star doesn't win).
  const topReview = [...input.reviews]
    .filter((r) => r.reviewCount >= 5 && nameById.has(r.competitorId))
    .sort((a, b) => b.score - a.score)[0];
  if (topReview) {
    const name = nameById.get(topReview.competitorId) ?? "A competitor";
    const label = REVIEW_SOURCE_LABELS[topReview.source] ?? topReview.source;
    out.push({
      kind: "reviews",
      competitorId: topReview.competitorId,
      text: `${name} scores ${topReview.score}/5 on ${label} across ${topReview.reviewCount} reviews.`,
    });
  }

  return out.slice(0, 3);
}
