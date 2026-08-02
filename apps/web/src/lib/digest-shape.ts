import { format } from "date-fns";
import type { Digest, DigestContent, DigestSection } from "./api";

export type DigestUrgency = DigestSection["urgency"];

/**
 * How the three urgency buckets are named and coloured, in one place.
 *
 * The stored enum values are pipeline vocabulary (`action_required` / `watch` /
 * `fyi`); the labels are the product's. A brief tells you what to do about a week,
 * so the buckets are phrased as decisions rather than as ticket levels, and the
 * list, the reader, the printed sheet and the Markdown export all read the same.
 */
export const URGENCY_ORDER: DigestUrgency[] = ["action_required", "watch", "fyi"];

export const URGENCY_META: Record<
  DigestUrgency,
  { label: string; tone: "critical" | "high" | "low"; swatch: string }
> = {
  action_required: { label: "Needs an answer", tone: "critical", swatch: "bg-critical" },
  watch: { label: "Worth watching", tone: "high", swatch: "bg-high" },
  fyi: { label: "Noted", tone: "low", swatch: "bg-low" },
};

/**
 * The period a brief covers, as a reader reads it: a weekly brief is a range, a
 * daily one is a single day. Falls back to the raw stored dates rather than
 * throwing on a malformed value.
 */
export function digestLabel(d: Pick<Digest, "period" | "weekStart" | "weekEnd">): string {
  if (d.period === "daily") {
    try {
      return format(new Date(d.weekStart), "EEE, MMM d, yyyy");
    } catch {
      return d.weekStart;
    }
  }
  try {
    return `${format(new Date(d.weekStart), "MMM d")} to ${format(
      new Date(d.weekEnd),
      "MMM d, yyyy",
    )}`;
  } catch {
    return `${d.weekStart} to ${d.weekEnd}`;
  }
}

/**
 * When the cron writes the brief, in UTC.
 *
 * Formatted through Intl with an explicit zone rather than date-fns `format`, which
 * reads the machine's: the server and the browser sit in different zones often enough
 * that the same instant would print a different weekday on each side and React would
 * flag the hydration mismatch. UTC also matches how the page names the schedule.
 */
export function digestRunLabel(iso: string): string {
  try {
    const stamp = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
    return `${stamp} UTC`;
  } catch {
    return iso;
  }
}

export interface DigestMover {
  name: string;
  count: number;
}

export interface DigestStats {
  moves: number;
  action: number;
  watch: number;
  fyi: number;
  /** Competitors that moved, busiest first, then alphabetical for a stable order. */
  movers: DigestMover[];
}

export function digestStats(content: DigestContent | null | undefined): DigestStats {
  const sections = content?.sections ?? [];
  const counts = new Map<string, number>();
  let action = 0;
  let watch = 0;
  let fyi = 0;

  for (const s of sections) {
    if (s.urgency === "action_required") action += 1;
    else if (s.urgency === "watch") watch += 1;
    else fyi += 1;
    const name = s.competitor?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const movers = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { moves: sections.length, action, watch, fyi, movers };
}

/**
 * The week's verdict. The model already writes it as the first TL;DR point, so the
 * reader leads with that sentence instead of hiding it under a label.
 */
export function digestHeadline(content: DigestContent | null | undefined): string | null {
  return content?.tldr?.[0]?.trim() || null;
}

/** The remaining TL;DR points, once the first one has been promoted to the headline. */
export function digestSupportingPoints(content: DigestContent | null | undefined): string[] {
  return (content?.tldr ?? []).slice(1).filter((t) => t.trim().length > 0);
}

/**
 * A week Outrival watched and found nothing in. The weekly job stores these with
 * empty tldr + sections, which used to render as a blank page.
 */
export function isQuietDigest(content: DigestContent | null | undefined): boolean {
  return (content?.sections?.length ?? 0) === 0 && (content?.tldr?.length ?? 0) === 0;
}

/**
 * What a calm week is worth saying: the work that established it. Falls back to the
 * bare statement for rows stored before the counts were kept.
 */
export function quietSentence(content: DigestContent | null | undefined): string {
  const quiet = content?.quiet;
  if (!quiet || quiet.pages <= 0) return "All quiet. Nothing moved.";
  const pages = `${quiet.pages} ${quiet.pages === 1 ? "page" : "pages"}`;
  const times =
    quiet.checks > 0 ? ` ${quiet.checks} ${quiet.checks === 1 ? "time" : "times"}` : "";
  return `All quiet. We checked ${pages}${times} and nothing moved.`;
}

/** Sections in reading order: what to answer, then what to watch, then the rest. */
export function digestGroups(
  content: DigestContent | null | undefined,
): Array<{ urgency: DigestUrgency; items: DigestSection[] }> {
  const sections = content?.sections ?? [];
  return URGENCY_ORDER.map((urgency) => ({
    urgency,
    items: sections.filter((s) => s.urgency === urgency),
  })).filter((g) => g.items.length > 0);
}

/**
 * The index a section holds in `content.sections`, which is the index its resolved
 * link holds too. Grouping for display must not lose that pairing.
 */
export function sectionIndex(
  content: DigestContent | null | undefined,
  section: DigestSection,
): number {
  return (content?.sections ?? []).indexOf(section);
}
