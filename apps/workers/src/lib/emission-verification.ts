import { and, eq, gte, inArray } from "drizzle-orm";
import { db, signalVerifications, snapshots } from "@outrival/db";
import {
  buildDeltaProof,
  formatExcerpts,
  hasDeltaEvidence,
  inverseFingerprintOf,
  type DeltaProof,
} from "@outrival/shared";
import { verifySignalDelta } from "@outrival/queue";
import { logger } from "./job-logger";
import {
  FLAP_WINDOW_DAYS,
  QUICK_CHECK_DELAY_MIN,
  VERIFICATION_ENABLED,
  shouldVerifyEmission,
  type VerificationSeverity,
} from "./verification-scope";

/**
 * The emission side of the double-capture (Véracité Intelligence v2 P2).
 *
 * generate-signal is the ONLY place a `signals` row is inserted — every emitter in
 * the fleet, the AI classifier and the dozen deterministic detectors alike, arrives
 * there through the queue. That makes it the single frontier where a signal can be
 * held back, and this module is what decides whether to hold this one.
 *
 * It runs BEFORE the insight call, so a deferred signal costs zero AI. When the
 * verification later confirms, generate-signal is re-enqueued with the SAME payload
 * and produces the insight then: one call, moved, never a second one. The
 * classification itself is never redone.
 */

/** The change fields the decision reads. */
export interface EmissionChange {
  id: string;
  monitorId: string;
  snapshotAfterId: string;
  diffText: string | null;
}

/** The monitor fields the decision reads. */
export interface EmissionMonitor {
  id: string;
  sourceType: string;
  config: unknown;
}

export interface InterceptResult {
  /** True when generate-signal must return WITHOUT emitting. */
  deferred: boolean;
  reason: string;
}

/**
 * The URL a re-capture would hit: the monitor's pinned URL, else the competitor's.
 * Same resolution scrape-monitor uses, so the verification asks for the page the
 * original capture asked for.
 */
export function monitorScrapeUrl(config: unknown, competitorUrl: string | null): string | null {
  const pinned =
    config && typeof config === "object" ? (config as { url?: unknown }).url : undefined;
  if (typeof pinned === "string" && pinned.trim().length > 0) return pinned;
  return competitorUrl && competitorUrl.trim().length > 0 ? competitorUrl : null;
}

function windowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Has this exact delta, or its exact reverse, already failed to reproduce on this
 * page inside the flap window?
 *
 * Queried on both fingerprints at once so the (delta_fingerprint, recorded_at) index
 * does the work. The inverse is the interesting half: A → B last week and B → A today
 * is not two changes of mind, it is one page serving two variants.
 */
export async function findFlapMatch(
  monitorId: string,
  proof: DeltaProof,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: signalVerifications.id })
    .from(signalVerifications)
    .where(
      and(
        eq(signalVerifications.monitorId, monitorId),
        eq(signalVerifications.outcome, "not_reproduced"),
        gte(signalVerifications.recordedAt, windowStart(now, FLAP_WINDOW_DAYS)),
        inArray(signalVerifications.deltaFingerprint, [
          proof.fingerprint,
          inverseFingerprintOf(proof),
        ]),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Decide whether this signal is emitted now or after a double capture.
 *
 * Returns `deferred: true` on three distinct paths, and the difference matters:
 *   - a verification is pending  → the signal is coming, later
 *   - a verification is running  → the signal is coming, later (this run just opened it)
 *   - the delta was NOT reproduced → the signal is dropped, silently and for good.
 *     No "unverified" alert is ever raised: the next scheduled scrape re-detects it
 *     if it was ever real, and a customer told "we saw something, maybe" has been
 *     given work, not intelligence.
 */
export async function interceptEmission(args: {
  change: EmissionChange;
  monitor: EmissionMonitor;
  competitorId: string;
  competitorUrl: string | null;
  severity: VerificationSeverity;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
  payload: { classification?: unknown; pricingTransition?: unknown };
  now?: Date;
}): Promise<InterceptResult> {
  if (!VERIFICATION_ENABLED) return { deferred: false, reason: "disabled" };
  const now = args.now ?? new Date();

  const existing = await db.query.signalVerifications.findFirst({
    where: eq(signalVerifications.changeId, args.change.id),
  });
  if (existing) {
    if (existing.outcome === "confirmed" || existing.outcome === "skipped") {
      return { deferred: false, reason: `verification_${existing.outcome}` };
    }
    if (existing.outcome === "not_reproduced") {
      // Silent retention. Logged, never surfaced.
      logger.log("Signal withheld: delta did not reproduce", {
        changeId: args.change.id,
        verificationId: existing.id,
      });
      return { deferred: true, reason: "not_reproduced" };
    }
    // Still pending: the verify job owns this change. Re-enqueueing here is exactly
    // the double-fetch (and, later, the double emission) the unique index exists to
    // prevent, so this run just steps aside.
    return { deferred: true, reason: "awaiting_verification" };
  }

  const proof = buildDeltaProof({
    diffText: args.change.diffText,
    humanChangeBefore: args.humanChangeBefore,
    humanChangeAfter: args.humanChangeAfter,
  });

  const after = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, args.change.snapshotAfterId),
    columns: { status: true, captureMethod: true },
  });

  const url = monitorScrapeUrl(args.monitor.config, args.competitorUrl);
  const flapMatch =
    hasDeltaEvidence(proof) && (await findFlapMatch(args.monitor.id, proof, now));

  const scope = shouldVerifyEmission({
    severity: args.severity,
    sourceType: args.monitor.sourceType,
    snapshotStatus: after?.status ?? null,
    captureMethod: after?.captureMethod ?? null,
    hasUrl: !!url,
    hasEvidence: hasDeltaEvidence(proof),
    flapMatch,
  });
  if (!scope.verify) return { deferred: false, reason: scope.reason };

  // The row IS the dedup key (pg-boss `standard` queues ignore singletonKey, see
  // plans/004): two concurrent generate-signal runs both reach here, exactly one
  // insert survives the unique index, and only that one enqueues a fetch.
  const [opened] = await db
    .insert(signalVerifications)
    .values({
      changeId: args.change.id,
      competitorId: args.competitorId,
      monitorId: args.monitor.id,
      deltaFingerprint: proof.fingerprint,
      firstExcerpt: formatExcerpts(proof),
      outcome: "pending",
      recordedAt: now,
    })
    .onConflictDoNothing({ target: signalVerifications.changeId })
    .returning();

  if (!opened) return { deferred: true, reason: "awaiting_verification" };

  await verifySignalDelta.enqueue(
    {
      changeId: args.change.id,
      pass: "quick",
      ...(args.payload.classification ? { classification: args.payload.classification } : {}),
      ...(args.payload.pricingTransition
        ? { pricingTransition: args.payload.pricingTransition }
        : {}),
    },
    { startAfter: QUICK_CHECK_DELAY_MIN * 60 },
  );

  logger.log("Signal emission deferred for double capture", {
    changeId: args.change.id,
    verificationId: opened.id,
    reason: scope.reason,
    severity: args.severity,
    sourceType: args.monitor.sourceType,
  });
  return { deferred: true, reason: scope.reason };
}

/**
 * Close the loop once the signal exists: which signal the verification produced, and
 * that it did produce one. Without `emitted`, "verified then lost to a crash" and
 * "verified and delivered" are the same row, and the phase's own claim (every
 * critical signal verified twice) becomes unauditable.
 *
 * Best-effort: a signal that exists must never be rolled back by its bookkeeping.
 */
export async function recordEmission(changeId: string, signalId: string): Promise<void> {
  try {
    await db
      .update(signalVerifications)
      .set({ emitted: 1, signalId })
      .where(eq(signalVerifications.changeId, changeId));
  } catch (err) {
    logger.warn("verification emission stamp failed (non-fatal)", {
      changeId,
      signalId,
      error: String(err),
    });
  }
}

/** The verification attached to a change, for the API and the tests. */
export async function verificationForChange(changeId: string) {
  return db.query.signalVerifications.findFirst({
    where: eq(signalVerifications.changeId, changeId),
  });
}
