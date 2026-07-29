import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { scoreOverlap } from "@outrival/ai";
import { db } from "./db";

/**
 * Single entry point for scoring ONE existing competitor's overlap, shared by the
 * manual-create path and the "Recompute overlap" kebab action.
 *
 * Why it exists: discovery scores a candidate with the text Exa returned for its
 * page, while both solo paths used to pass `competitor.description` — which the
 * candidate-add path never writes, so every discovery-added competitor was
 * re-scored on a bare domain plus a name derived from its URL. The model has
 * nothing to judge and scores low, so a competitor that discovery put at 85 came
 * back at 5, which also sinks its signals (the feed's threat sort multiplies by
 * overlapScore / 100).
 *
 * Two rules follow: the evidence comes from the same ladder everywhere, and a
 * score is never written when there is no evidence to base it on.
 */

/** The competitor fields the scorer reads. */
export interface OverlapSubject {
  name: string;
  url: string | null;
  description: string | null;
  aiSummary: string | null;
}

export type OverlapOutcome =
  | { status: "scored"; overlapScore: number; reason: string }
  | { status: "no_url" }
  | { status: "no_profile" }
  | { status: "no_evidence" }
  | { status: "failed" };

// Bounds the prompt (and therefore the cache key) without cutting a summary short
// enough to change the judgement: refresh-competitor-summary's output sits well
// under this.
const MAX_EVIDENCE_CHARS = 1500;

/**
 * What the model gets to judge the competitor on, best first:
 * 1. `aiSummary` — refresh-competitor-summary builds it from the latest homepage
 *    capture plus recent signals and reviews, so after the first scrape it is the
 *    richest description of the competitor we hold.
 * 2. `description` — only ever set when the user typed one on manual create.
 *
 * Deliberately no third rung reading the homepage snapshot off R2: it would only
 * cover the window between a first scrape and its summary, and the API cannot
 * import the workers' html-to-text helper (monorepo boundary).
 */
export function overlapEvidence(subject: OverlapSubject): string | null {
  const evidence = subject.aiSummary?.trim() || subject.description?.trim() || "";
  return evidence ? evidence.slice(0, MAX_EVIDENCE_CHARS) : null;
}

export async function scoreCompetitorOverlap(
  orgId: string,
  subject: OverlapSubject,
): Promise<OverlapOutcome> {
  if (!subject.url) return { status: "no_url" };

  const evidence = overlapEvidence(subject);
  if (!evidence) return { status: "no_evidence" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { productProfile: true },
  });
  if (!org?.productProfile) return { status: "no_profile" };

  let scored: Awaited<ReturnType<typeof scoreOverlap>>;
  try {
    scored = await scoreOverlap(org.productProfile, [
      { url: subject.url, title: subject.name, snippet: evidence },
    ]);
  } catch {
    return { status: "failed" };
  }

  // `scored: false` carries a 0 that means "no score", not "no overlap" — writing
  // it would let one AI outage zero every competitor the user re-scores.
  const first = scored[0];
  if (!first?.scored) return { status: "failed" };
  return { status: "scored", overlapScore: first.overlapScore, reason: first.reason };
}
