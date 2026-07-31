import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { scoreOverlap, selfProfileToDiscoveryProfile, type ProductProfile } from "@outrival/ai";
import { db } from "./db";
import { competitorAnchorProduct, productDiscoveryTarget } from "./products";

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
 * Three rules follow: the evidence comes from the same ladder everywhere, a score
 * is never written when there is no evidence to base it on, and the competitor is
 * judged against the product it belongs to (see `scoringProfile`).
 */

/** The competitor fields the scorer reads. */
export interface OverlapSubject {
  /** Resolves which product's profile this competitor is judged against. */
  id: string;
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
  const [outcome] = await scoreCompetitorsOverlap(orgId, [subject]);
  return outcome ?? { status: "failed" };
}

// Bucket key for competitors that resolve to no product at all (an org still
// mid-onboarding, or a legacy org with no `products` row). Product ids are UUIDs,
// so this can never collide with one.
const ORG_PROFILE_KEY = "org";

/**
 * The product profile a competitor is judged against.
 *
 * NOT the org's `productProfile`: that field is the LEGACY, org-wide profile, which
 * in a multi-SKU org describes only the primary product. Discovery already scores
 * per product (`detectCandidatesForProduct` runs on the SKU's own self-profile), so
 * reading the org field here re-scored a competitor against a product it has nothing
 * to do with — a social-media tool discovered at 95 for a scheduling SKU came back
 * at 3 because it was re-judged against the org's VPS-hosting primary. The 3 was a
 * correct answer to the wrong question.
 *
 * Anchor priority matches `competitorAnchorProduct` (the same rule battle cards and
 * signal insights use), and the org profile stays the fallback for the PRIMARY
 * product only — a secondary SKU must never borrow it, or it would be judged as
 * something else entirely.
 */
async function scoringProfile(
  orgId: string,
  productKey: string,
  orgProfile: ProductProfile | null,
): Promise<ProductProfile | null> {
  if (productKey === ORG_PROFILE_KEY) return orgProfile;
  const target = await productDiscoveryTarget(orgId, productKey);
  if (!target) return orgProfile;
  return selfProfileToDiscoveryProfile(target.selfProfile, target.isPrimary ? orgProfile : null);
}

/**
 * Batched re-score, one outcome per subject in the order they were given.
 *
 * `scoreOverlap` already takes a LIST and grades each entry independently against
 * the fixed scale (that is how discovery scores a whole candidate pool), so the
 * bulk roster action costs ONE model call and ONE rate-limit hit rather than N —
 * per product, since a selection spanning two SKUs cannot share one prompt.
 * Subjects with nothing to judge them on are answered from here without ever
 * reaching the model, so a set that is half unscorable still spends one call.
 */
export async function scoreCompetitorsOverlap(
  orgId: string,
  subjects: OverlapSubject[],
): Promise<OverlapOutcome[]> {
  if (subjects.length === 0) return [];

  // Per-subject preconditions first: url and evidence are properties of the row,
  // and a subject that fails them must not enter the prompt (it would take a score
  // built on a bare domain — the 85-becomes-5 failure this module exists to stop).
  type Scorable = { id: string; url: string; name: string; evidence: string };
  type Prepared = { skip: OverlapOutcome } | Scorable;
  const prepared: Prepared[] = subjects.map((subject) => {
    if (!subject.url) return { skip: { status: "no_url" } };
    const evidence = overlapEvidence(subject);
    if (!evidence) return { skip: { status: "no_evidence" } };
    return { id: subject.id, url: subject.url, name: subject.name, evidence };
  });

  // Scorable slots start at "failed" and are overwritten by their own group, so a
  // model outage in one product's call never writes a score for another's.
  const outcomes: OverlapOutcome[] = prepared.map((p) =>
    "skip" in p ? p.skip : { status: "failed" },
  );

  // One group per product the selection is anchored to.
  const groups = new Map<string, number[]>();
  for (const [i, p] of prepared.entries()) {
    if ("skip" in p) continue;
    const anchor = await competitorAnchorProduct(orgId, p.id);
    const key = anchor?.id ?? ORG_PROFILE_KEY;
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  if (groups.size === 0) return outcomes;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { productProfile: true },
  });

  for (const [key, slots] of groups) {
    const profile = await scoringProfile(orgId, key, org?.productProfile ?? null);
    if (!profile) {
      for (const slot of slots) outcomes[slot] = { status: "no_profile" };
      continue;
    }

    const items = slots.map((slot) => prepared[slot] as Scorable);
    let scored: Awaited<ReturnType<typeof scoreOverlap>>;
    try {
      scored = await scoreOverlap(
        profile,
        items.map((p) => ({ url: p.url, title: p.name, snippet: p.evidence })),
      );
    } catch {
      continue; // slots keep their "failed" default
    }

    // Results come back positionally aligned with what we sent (scoreOverlap resolves
    // its own url/positional matching internally), so walk the group in step.
    slots.forEach((slot, i) => {
      const hit = scored[i];
      // `scored: false` carries a 0 that means "no score", not "no overlap" — writing
      // it would let one AI outage zero every competitor the user re-scores.
      if (hit?.scored) {
        outcomes[slot] = { status: "scored", overlapScore: hit.overlapScore, reason: hit.reason };
      }
    });
  }

  return outcomes;
}
