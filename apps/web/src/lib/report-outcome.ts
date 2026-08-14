import type { BattleCardContent, MonthlyRecap } from "./api";

// The public share view (/report/[token]) is read by someone with no session, no
// dashboard and nobody to ask: whatever that page says IS their diagnosis. Two things
// it got wrong (OUT-189, same family as OUT-187..190):
//
//   1. Every failure — API down, 502 from the proxy, connection never opened — read
//      as "the link may have been revoked". A reader who only had to refresh instead
//      went back to the sender for a new link, and the sender had nothing to fix.
//   2. A payload announcing a `kind` it didn't carry (a recap share whose recap came
//      back empty) fell through to the landscape branch, which reads `pricing` and
//      `competitors` unconditionally — a TypeError, i.e. a 500 served to a stranger.
//
// Both decisions live here as pure functions so they can be tested without a render.

export type PricingRow = {
  competitorId: string;
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
};

export type ReportCompetitor = {
  id: string;
  name: string;
  url: string | null;
  category: string | null;
  aiSummary: string | null;
};

export type SharedReport = {
  org: { name: string };
  product: { name: string } | null;
  generatedAt: string;
  // The user's own product — anchors the "you vs the field" row in the matrix.
  self: { id: string; name: string; url: string | null } | null;
  selfPricing: PricingRow[];
  competitors: ReportCompetitor[];
  pricing: PricingRow[];
  hiring: { competitorId: string; total: number }[];
  reviews: { competitorId: string; source: string; score: number; reviewCount: number }[];
  recentActivity: {
    competitorName: string;
    title: string;
    link: string | null;
    source: string | null;
    publishedAt: string | null;
  }[];
  insights: { kind: string; text: string }[];
  // Discriminator (Lever 9): "recap" → the shared Wrapped instead of the landscape.
  // "battle_card" (OUT-193) → one competitor's card, resolved live from the couple the
  // token names, so a card the auto-refresh rewrote shows through the same link.
  kind?: "landscape" | "recap" | "battle_card";
  recap?: MonthlyRecap;
  competitor?: { name: string };
  content?: BattleCardContent;
};

// Why the report didn't render. "revoked" is final for this link and the reader's move
// is to ask the sender for another; "unavailable" is our side and the same link may
// work on the next load.
export type ReportFailure = "revoked" | "unavailable";

// The public resolver answers 404 for a token that is revoked, unknown or malformed —
// the only case where the link itself is the problem. Everything else (5xx, a proxy's
// 502, a body that isn't JSON, a request that never left) is ours.
export function reportFailureFromStatus(status: number): ReportFailure {
  return status === 404 || status === 410 ? "revoked" : "unavailable";
}

export const REPORT_FAILURE_COPY: Record<ReportFailure, { title: string; description: string }> = {
  revoked: {
    title: "This link is no longer valid",
    description:
      "The report was unshared, or this link never existed. Ask whoever sent it for a new one.",
  },
  unavailable: {
    title: "This report didn’t load",
    description:
      "Something went wrong on our side, and the link itself is fine. Refresh the page in a minute.",
  },
};

// What the payload actually carries, with the payload narrowed so the page never has
// to assert it back. "incomplete" is a server fault, not a dead link: it renders the
// "unavailable" screen rather than crashing on the landscape fields.
export type ReportView =
  | { view: "landscape" }
  | { view: "recap"; recap: MonthlyRecap }
  | { view: "battle_card"; content: BattleCardContent; competitor: { name: string } }
  | { view: "incomplete" };

export function resolveReportView(report: SharedReport): ReportView {
  if (report.kind === "recap") {
    return report.recap ? { view: "recap", recap: report.recap } : { view: "incomplete" };
  }
  if (report.kind === "battle_card") {
    return report.content && report.competitor
      ? { view: "battle_card", content: report.content, competitor: report.competitor }
      : { view: "incomplete" };
  }
  // No `kind` at all is a landscape: the field was added after the first share links
  // were minted. Either way the matrix iterates these two lists on every render.
  return Array.isArray(report.competitors) && Array.isArray(report.pricing)
    ? { view: "landscape" }
    : { view: "incomplete" };
}

// The tab title. It used to be the literal "Competitive Snapshot" for all three shares,
// so a recap and a battle card both filed themselves under the wrong name in the
// reader's tab strip and in whatever they pasted the link into. Rendered through the
// root "%s | Outrival" template — no suffix here, or it lands twice.
export function reportTitle(report: SharedReport): string {
  const resolved = resolveReportView(report);
  switch (resolved.view) {
    case "recap":
      return `${report.org.name} · ${resolved.recap.month.label} recap`;
    case "battle_card":
      return `${report.product ? report.product.name : report.org.name} vs ${resolved.competitor.name}`;
    case "landscape":
      return `${report.org.name} · Competitive snapshot`;
    case "incomplete":
      return "Shared report";
  }
}
