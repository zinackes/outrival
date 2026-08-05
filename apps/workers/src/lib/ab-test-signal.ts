import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, changes, monitors, signalVerifications, snapshots } from "@outrival/db";
import { computeHash, uploadToR2, isInverse, type DeltaProof } from "@outrival/shared";
import { generateSignal } from "@outrival/queue";
import { logger } from "./job-logger";
import {
  AB_TEST_COOLDOWN_DAYS,
  AB_TEST_MIN_OBSERVATIONS,
  FLAP_WINDOW_DAYS,
} from "./verification-scope";

/**
 * ab_test_suspected — the phase's only new signal (Véracité Intelligence v2 P2).
 *
 * Every other piece of P2 removes signals. This one is where the removed noise comes
 * back as intelligence: a page that serves a delta, then its exact inverse, twice
 * inside a fortnight is not a competitor changing its mind twice. It is a competitor
 * running a test, and knowing that a rival is testing a $79 against a $99 tier is
 * worth more than either number would have been.
 *
 * Deterministic end to end. No AI decides that a page is under test; the model is
 * only asked, downstream in generate-signal, to write the insight for a finding that
 * was already made.
 */

/** How the two variants read on the page, newest observation first. */
interface Variants {
  a: string;
  b: string;
}

function windowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * The observations backing the claim: not_reproduced verifications on this page, in
 * the flap window, carrying this delta or its exact inverse.
 *
 * Loaded and filtered in JS rather than matched in SQL because "or its inverse" is a
 * property of the PROOF, not of a column: the inverse fingerprint is derived from the
 * excerpts. The window is a handful of rows on one monitor, so the index does the
 * narrowing and the predicate stays readable.
 */
async function countObservations(
  monitorId: string,
  proof: DeltaProof,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ fingerprint: signalVerifications.deltaFingerprint })
    .from(signalVerifications)
    .where(
      and(
        eq(signalVerifications.monitorId, monitorId),
        eq(signalVerifications.outcome, "not_reproduced"),
        gte(signalVerifications.recordedAt, windowStart(now, FLAP_WINDOW_DAYS)),
      ),
    );
  return rows.filter((r) => r.fingerprint === proof.fingerprint || isInverse(r.fingerprint, proof))
    .length;
}

/**
 * Has this page already raised the finding recently?
 *
 * The anchor's own change rows ARE the ledger, the same way every synthetic anchor in
 * this codebase works. A test runs for weeks and flaps continuously inside it: told
 * once, it is a finding; told at every flip, it is the noise this whole phase exists
 * to remove.
 */
async function inCooldown(monitorId: string, now: Date): Promise<boolean> {
  const [recent] = await db
    .select({ id: changes.id })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(
      and(
        eq(monitors.sourceType, "page_variance"),
        sql`${changes.rawDiff}->>'monitorId' = ${monitorId}`,
        gte(changes.detectedAt, windowStart(now, AB_TEST_COOLDOWN_DAYS)),
      ),
    )
    .limit(1);
  return !!recent;
}

/** A pricing test moves money, so it is worth a digest slot; anywhere else the same
 *  observation is context. Neither ever pages anyone: a suspicion is not an event. */
function severityFor(sourceType: string): "medium" | "low" {
  return sourceType === "pricing" ? "medium" : "low";
}

/** The closest existing category. Deliberately NOT a new enum value: a page under
 *  test is a pricing fact on a pricing page and a messaging fact anywhere else. */
function categoryFor(sourceType: string): "pricing" | "content" {
  return sourceType === "pricing" ? "pricing" : "content";
}

/** The two variants, read off the delta: what the page had, and what it also serves. */
function variantsOf(proof: DeltaProof): Variants | null {
  const a = proof.removedExcerpts[0];
  const b = proof.addedExcerpts[0];
  if (!a || !b) return null;
  return { a, b };
}

/**
 * The synthetic anchor the signal hangs off, on the competitor's `page_variance`
 * monitor. Its own anchor, not the flapping monitor's: that chain is what content-hash
 * dedup diffs the NEXT real capture against, and the change this finding is about
 * already carries a verification row whose verdict is "do not emit this one".
 *
 * R2 before DB (snapshots.r2Key is NOT NULL, and the body IS what the insight will be
 * grounded on).
 */
async function writeVarianceAnchor(args: {
  competitorId: string;
  competitorUrl: string | null;
  flappingMonitorId: string;
  sourceType: string;
  diffText: string;
  observations: number;
  variants: Variants;
  now: Date;
}): Promise<string> {
  let monitor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, args.competitorId),
      eq(monitors.sourceType, "page_variance"),
    ),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId: args.competitorId,
        sourceType: "page_variance",
        frequency: "weekly", // unused: this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure page_variance monitor");

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  const r2Key = `snapshots/${args.competitorId}/page_variance/${args.now.toISOString()}`;
  await uploadToR2(`${r2Key}.txt`, args.diffText, "text/plain; charset=utf-8", { compress: true });

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      monitorId: monitor.id,
      r2Key,
      // Unique per emission: the cooldown query above is the dedup, not this hash.
      // A single gate that is queryable beats two half-gates that disagree.
      contentHash: computeHash(`${args.flappingMonitorId}:${args.now.toISOString()}`),
      status: "success",
      scrapedAt: args.now,
      resolvedUrl: args.competitorUrl,
    })
    .returning();
  if (!snapshot) throw new Error("Failed to insert page_variance snapshot");

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: monitor.id,
      snapshotBeforeId: prevSnapshot?.id ?? null,
      snapshotAfterId: snapshot.id,
      diffText: args.diffText,
      diffType: "text",
      rawDiff: {
        kind: "ab_test_suspected",
        // Read by the cooldown query — the flapping page, not this anchor.
        monitorId: args.flappingMonitorId,
        sourceType: args.sourceType,
        observations: args.observations,
        variantA: args.variants.a,
        variantB: args.variants.b,
      },
      detectedAt: args.now,
    })
    .returning();
  if (!change) throw new Error("Failed to insert page_variance change");
  return change.id;
}

export interface AbTestEmitResult {
  emitted: boolean;
  reason: "below_threshold" | "cooldown" | "no_variants" | "emitted";
  observations: number;
}

/**
 * Called every time a verification ends `not_reproduced`. Emits at most once per page
 * per cooldown; below the threshold it does nothing at all, which is the silence the
 * decision asks for.
 */
export async function maybeEmitAbTestSignal(args: {
  monitorId: string;
  competitorId: string;
  competitorUrl: string | null;
  sourceType: string;
  proof: DeltaProof;
  now?: Date;
}): Promise<AbTestEmitResult> {
  const now = args.now ?? new Date();
  const observations = await countObservations(args.monitorId, args.proof, now);
  if (observations < AB_TEST_MIN_OBSERVATIONS) {
    return { emitted: false, reason: "below_threshold", observations };
  }
  const variants = variantsOf(args.proof);
  if (!variants) return { emitted: false, reason: "no_variants", observations };
  if (await inCooldown(args.monitorId, now)) {
    logger.log("ab_test_suspected suppressed by cooldown", {
      monitorId: args.monitorId,
      observations,
    });
    return { emitted: false, reason: "cooldown", observations };
  }

  const label = args.sourceType === "pricing" ? "Pricing page" : "Homepage";
  const headline = `${label} A/B test suspected — "${variants.a}" ↔ "${variants.b}"`;
  const diffText =
    `${headline}\n\n` +
    `Across the last ${FLAP_WINDOW_DAYS} days this page served a change and then its ` +
    `exact inverse ${observations} times: each time the change was detected, an ` +
    `independent capture taken later found the previous variant back in place. ` +
    `Neither reading is wrong — the page is serving both.\n\n` +
    `Variant A: ${variants.a}\n` +
    `Variant B: ${variants.b}\n\n` +
    `A competitor running a test on this page has not decided anything yet, which is ` +
    `exactly why it is worth knowing now: the decision is still open, and what they ` +
    `are testing says what they think is negotiable.`;

  const changeId = await writeVarianceAnchor({
    competitorId: args.competitorId,
    competitorUrl: args.competitorUrl,
    flappingMonitorId: args.monitorId,
    sourceType: args.sourceType,
    diffText,
    observations,
    variants,
    now,
  });

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: categoryFor(args.sourceType),
      severity: severityFor(args.sourceType),
      is_significant: true,
      reason: headline,
      humanChangeBefore: variants.a,
      humanChangeAfter: variants.b,
    },
    // This signal IS the conclusion of a verification. Sending it back through one
    // would defer it against a page that, by definition, will not reproduce.
    skipVerification: true,
  });

  logger.log("ab_test_suspected emitted", {
    monitorId: args.monitorId,
    competitorId: args.competitorId,
    observations,
    changeId,
  });
  return { emitted: true, reason: "emitted", observations };
}
