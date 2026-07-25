import { format, isToday, isYesterday } from "date-fns";
import type {
  ActivityCaptured,
  ActivityEvent,
  ActivityStatusFilter,
} from "@/lib/api";

// The four user-facing outcomes, derived from the raw run status. scrape_runs
// .status="success" covers three different things — a real change, a monitor's
// baseline capture, and a sub-threshold content shift — so a flat status→label
// map would call a first scrape a "change".
export type Outcome = ActivityStatusFilter;

export function eventOutcome(e: ActivityEvent): Outcome {
  if (e.status === "failed") return "failed";
  if (e.status === "success") {
    if (e.changeId) return "change";
    if (e.isFirstCapture) return "first_capture";
  }
  return "no_change";
}

// ── Days ─────────────────────────────────────────────────────────────────────
// The log groups by the viewer's day, and the summary's tallies are bucketed by
// the same offset server-side, so a header and its rows always agree.

/** Local day key (YYYY-MM-DD) of an instant. */
export function dayKeyOf(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

/** "Today" / "Yesterday" / "Fri, Jul 18" for a local day key. */
export function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

/**
 * The UTC instants bounding a local day, for the quiet-run fetch. A key parsed
 * without a zone is local by definition, so this converts the user's midnight,
 * not the server's.
 */
export function dayBounds(key: string): { from: string; to: string } {
  const start = new Date(`${key}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** How long the scrape took. Ops detail: it lives in the expanded row. */
export function duration(ms: number): string {
  if (!ms) return "unknown";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Structured homepage changes ──────────────────────────────────────────────

// Readable label per structured-diff kind. Sentence case, not an uppercase mono
// eyebrow — these read as plain field names, not tags.
const KIND_LABEL: Record<string, string> = {
  hero_headline_changed: "Headline",
  hero_subheadline_changed: "Subheadline",
  hero_cta_changed: "Call-to-action",
  section_added: "New section",
  section_removed: "Section removed",
  section_renamed: "Section renamed",
  section_body_changed: "Section updated",
  navigation_changed: "Navigation",
  meta_changed: "Branding",
  social_proof_changed: "Social proof",
  visual_redesign: "Visual redesign",
  numeric_claim_changed: "Metric",
  customer_logo_added: "New customer",
  customer_logo_removed: "Customer removed",
  testimonial_added: "New testimonial",
  testimonial_removed: "Testimonial removed",
};

// Kinds with no natural before/after — a plain phrase instead of an arrow.
export const STATIC_PHRASE: Record<string, string> = {
  visual_redesign: "The homepage was visually redesigned",
  section_reordered: "Sections were reordered",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "Change";
}

/** "sections[pricing]" → "pricing", a readable subject for section_* kinds. */
export function sectionName(field: string): string | null {
  const m = field.match(/sections?\[([^\]]+)\]/i);
  return m ? m[1]!.replace(/[_-]+/g, " ") : null;
}

// ── Captured data ────────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
export const PERIOD_SHORT: Record<string, string> = { monthly: "mo", yearly: "yr" };

export function fmtPrice(value: number | null, currency: string | null): string {
  if (value == null) return "";
  const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const sym = currency ? CURRENCY_SYMBOL[currency] : undefined;
  return sym ? `${sym}${n}` : currency ? `${n} ${currency}` : n;
}

/**
 * The one-line snapshot a run captured. null when the extraction came back empty
 * — the row says "nothing found" and offers no breakdown, because there is none.
 */
export function capturedSummary(c: ActivityCaptured): string | null {
  if (c.kind === "jobs") {
    if (c.total === 0) return null;
    const roles = `${c.total} open role${c.total > 1 ? "s" : ""}`;
    return c.teams > 1 ? `${roles}, ${c.teams} teams` : roles;
  }
  if (c.kind === "pricing") {
    if (c.planCount === 0) return null;
    const plans = `${c.planCount} plan${c.planCount > 1 ? "s" : ""}`;
    if (c.minPrice == null) return plans; // all quote-based tiers
    const range =
      c.maxPrice != null && c.maxPrice !== c.minPrice
        ? `${fmtPrice(c.minPrice, c.currency)} to ${fmtPrice(c.maxPrice, c.currency)}`
        : fmtPrice(c.minPrice, c.currency);
    return `${plans} · ${range}`;
  }
  if (c.score == null) return null;
  const stars = `${c.score.toFixed(1)}★`;
  return c.reviewCount > 0 ? `${stars} · ${c.reviewCount.toLocaleString()} reviews` : stars;
}

/** Whether a captured payload has anything to break down in the expanded row. */
export function hasCapturedDetail(c: ActivityCaptured | null | undefined): boolean {
  return !!c && capturedSummary(c) != null;
}
