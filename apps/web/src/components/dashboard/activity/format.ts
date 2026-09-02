import { format, isSameDay, subDays } from "date-fns";
import { nowOnClock, onClock } from "@/lib/hydration-clock";
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
//
// `local` is the caller's `useHydrated()`: false on the server and on the first
// client render, so both derive the SAME buckets, true from the mount effect on.
// Without it the two runtimes cut the day at two different instants and produce a
// different set of sections — a structural hydration failure, not a text one
// (`code:PER-24`). See `@/lib/hydration-clock`.

/** Day key (YYYY-MM-DD) of an instant, on the caller's clock. */
export function dayKeyOf(iso: string, local: boolean): string {
  return format(onClock(iso, local), "yyyy-MM-dd");
}

/** "Today" / "Yesterday" / "Fri, Jul 18" for a day key cut on the same clock. */
export function dayLabel(key: string, local: boolean): string {
  // A key is already a calendar day, so it parses at local midnight and never moves;
  // only the "now" it is measured against has to follow the caller's clock.
  const d = new Date(`${key}T00:00:00`);
  const now = nowOnClock(local);
  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, subDays(now, 1))) return "Yesterday";
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

// ── Watch strip bars ─────────────────────────────────────────────────────────

/** What one slice of an hour's bar stands for. */
export type BarKind = "quiet" | "change" | "failed";

export interface BarSegment {
  kind: BarKind;
  height: number;
  count: number;
}

// Smallest slice that still reads as a slice. One change inside a busy hour has
// to stay visible, so a present outcome is never allowed to round down to
// nothing.
const MIN_SEGMENT = 3;

/**
 * One hour's bar split into its outcomes, bottom to top: the routine checks
 * first, then the changes, then the failures. An hour holds several checks and
 * they do not all end the same way — colouring the whole bar by the worst one
 * would erase the changes behind a single failure, so each outcome gets its own
 * slice, sized by how many checks it accounts for.
 *
 * Returns the segments and the height they need: a bar carrying three outcomes
 * cannot be shorter than three minimum slices, so the volume height is raised to
 * fit rather than the slices being squeezed out of existence.
 */
export function barSegments(
  height: number,
  checks: number,
  changes: number,
  failures: number,
): { segments: BarSegment[]; height: number } {
  // changes and failures are counted by disjoint filters server-side, so what is
  // left is the checks that ran and found nothing.
  const parts: BarSegment[] = (
    [
      { kind: "quiet", count: Math.max(0, checks - changes - failures), height: 0 },
      { kind: "change", count: changes, height: 0 },
      { kind: "failed", count: failures, height: 0 },
    ] satisfies BarSegment[]
  ).filter((p) => p.count > 0);

  if (parts.length === 0) return { segments: [{ kind: "quiet", count: 0, height }], height };
  if (parts.length === 1) return { segments: [{ ...parts[0]!, height }], height };

  const total = Math.max(height, parts.length * MIN_SEGMENT);
  for (const p of parts) p.height = Math.max(MIN_SEGMENT, Math.round((total * p.count) / checks));

  // Rounding and the floor both push the stack off `total`; the biggest slice
  // absorbs the difference, since it is the one that can lose a pixel without
  // changing what it says.
  const biggest = parts.reduce((m, p) => (p.height > m.height ? p : m), parts[0]!);
  biggest.height = Math.max(MIN_SEGMENT, biggest.height + total - parts.reduce((n, p) => n + p.height, 0));

  return { segments: parts, height: parts.reduce((n, p) => n + p.height, 0) };
}

// ── Skipped runs ─────────────────────────────────────────────────────────────
//
// A run the worker logged as `skipped`: it opened nothing, because there was
// nothing of this kind to open. Two sentences per reason — the row's one-liner
// and, in the panel, what it means for the competitor — keyed on the marker the
// scraper itself threw (apps/workers/src/core/scrape-monitor.ts benignSkipFrom).
//
// Without this a skip inherited the no-change copy and the feed said "Nothing
// new · We read this page and it matches our last capture" about a page it had
// never opened. Measured on prod 2026-08-04: 145 roadmap skips in seven days.

interface SkipCopy {
  /** The row's one-liner, in the "what happened" column. */
  short: string;
  /** The expanded panel's sentence. */
  detail: string;
}

const SKIP_COPY: Record<string, SkipCopy> = {
  no_roadmap_portal: {
    short: "No public roadmap to read",
    detail:
      "We looked for a public roadmap or feedback portal and found none, so there was nothing to read. If they publish one at an address we missed, point us at it from the source's settings.",
  },
  portal_private: {
    short: "Their roadmap portal is private",
    detail:
      "They run a roadmap portal, but its board is access-restricted. We stop at that rather than work around it, so nothing is collected from it.",
  },
  portal_empty: {
    short: "Their roadmap portal is empty",
    detail:
      "Their roadmap portal is public and currently carries no entries. We keep checking it, and the first entry they publish will show up here.",
  },
  no_docs_surface: {
    short: "No public developer docs",
    detail:
      "We found no public developer documentation for this competitor, so there was nothing to read.",
  },
  no_channel: {
    short: "No YouTube channel linked",
    detail: "This competitor links no YouTube channel, so there was nothing to read.",
  },
  no_sitemap_found: {
    short: "No sitemap published",
    detail: "This site publishes no sitemap.xml, so there was nothing to read.",
  },
  no_live_subdomains: {
    short: "No live subdomains found",
    detail: "No live subdomain came back for this competitor on this check.",
  },
  crtsh_unavailable: {
    short: "Certificate log unavailable",
    detail:
      "The certificate transparency log we read subdomains from did not answer. Nothing is wrong with the competitor: we try again on the next check.",
  },
};

const SKIP_FALLBACK: SkipCopy = {
  short: "Nothing to read on this source",
  detail: "There was nothing of this kind to read on this check.",
};

/** How a `skipped` run reads. Null for any other status. */
export function skipCopy(e: ActivityEvent): SkipCopy | null {
  if (e.status !== "skipped") return null;
  return (e.failureReason ? SKIP_COPY[e.failureReason] : null) ?? SKIP_FALLBACK;
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
