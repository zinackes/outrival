import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal, verifySignalDelta } from "@outrival/queue";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, changes, competitors, monitors, signalVerifications, snapshots } from "@outrival/db";
import {
  checkDeltaAgainst,
  parseExcerpts,
  type DeltaCheckResult,
  type DeltaProof,
} from "@outrival/shared";
import { extractContent } from "@outrival/scrapers/extract";
import {
  computeCompleteness,
  countCaptureAnchors,
  isPartialScore,
} from "@outrival/scrapers/completeness";
import { monitorScrapeUrl } from "../lib/emission-verification";
import { maybeEmitAbTestSignal } from "../lib/ab-test-signal";
import { independentPassDelayMin } from "../lib/verification-scope";

/**
 * The double capture (Véracité Intelligence v2 P2), in two passes.
 *
 *   quick        T+2 min  — kills the transient. A half-rendered page, an error page
 *                           served for a few seconds, a deploy caught mid-flight: all
 *                           of them are gone by now, and none of them was a change.
 *   independent  T+30 min — the real test. The delay IS the independence: a re-fetch
 *                           a second later reads the same CDN object, the same A/B
 *                           bucket and the same half-finished deploy, so it can only
 *                           ever agree with the first capture.
 *
 * ONE fetch per pass, two per change, ever (`retryLimit: 0` on the queue). Politeness
 * is not a side concern here: this is extra traffic on a competitor's page for our
 * benefit, and the collection doctrine's per-domain gap and robots check apply to it
 * through the same cascade every other capture goes through.
 *
 * Zero AI. The change was classified before the emission was deferred, and it is
 * never reclassified: this job decides whether the PAGE still says what it said, not
 * whether the change matters.
 */

const InputSchema = z.object({
  changeId: z.string(),
  pass: z.enum(["quick", "independent"]),
  classification: z.unknown().optional(),
  pricingTransition: z.unknown().optional(),
});

type Input = z.infer<typeof InputSchema>;

/** What the second capture had to say about the delta, for the stored evidence. */
function describeCheck(check: DeltaCheckResult, proof: DeltaProof): string {
  if (check.reproduced) {
    return [
      ...proof.removedExcerpts.map((e) => `- ${e}`),
      ...proof.addedExcerpts.map((e) => `+ ${e}`),
    ].join("\n");
  }
  return [
    ...check.missingAdded.map((e) => `missing: ${e}`),
    ...check.lingeringRemoved.map((e) => `still present: ${e}`),
  ].join("\n");
}

/**
 * Hand the emission back to generate-signal with the payload it was deferred with.
 * The verification row is already stamped, so the interception there reads
 * confirmed/skipped and lets the run through. The signal's own unique index on
 * change_id is the last line of defence against a double emission.
 */
async function emitNow(input: Input): Promise<void> {
  await generateSignal.enqueue({
    changeId: input.changeId,
    ...(input.classification ? { classification: input.classification } : {}),
    ...(input.pricingTransition ? { pricingTransition: input.pricingTransition } : {}),
  });
}

export async function runVerifySignalDelta(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting verify-signal-delta", { changeId: input.changeId, pass: input.pass });

  const verification = await db.query.signalVerifications.findFirst({
    where: eq(signalVerifications.changeId, input.changeId),
  });
  if (!verification) {
    throw new AbortTaskRunError(`No verification opened for change ${input.changeId}`);
  }
  if (verification.outcome !== "pending") {
    // Already settled (a duplicate job, a manual replay). Idempotent by construction:
    // re-running must never fetch the page again, and must never emit a second time.
    logger.log("Verification already settled, skipping", {
      changeId: input.changeId,
      outcome: verification.outcome,
    });
    return { skipped: true, outcome: verification.outcome };
  }

  const now = new Date();
  const stampField = input.pass === "quick" ? "quickCheckAt" : "independentCheckAt";

  /** Settle the row, then act. Order matters: a crash after the stamp leaves a row
   *  that generate-signal can read; a crash before it leaves the pass replayable. */
  const settle = async (
    outcome: "confirmed" | "not_reproduced" | "skipped",
    secondExcerpt: string | null,
  ) => {
    await db
      .update(signalVerifications)
      .set({ outcome, secondExcerpt, [stampField]: now })
      .where(eq(signalVerifications.id, verification.id));
  };

  try {
    const change = await db.query.changes.findFirst({ where: eq(changes.id, input.changeId) });
    if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, change.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${change.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

    const original = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, change.snapshotAfterId),
      columns: { captureMethod: true, contentSize: true },
    });
    const url = monitorScrapeUrl(monitor.config, competitor.url);
    const proof = parseExcerpts(verification.firstExcerpt, verification.deltaFingerprint);

    // The interception already established both of these; re-checking here costs one
    // comparison and closes the window where a monitor was edited in between.
    if (!url || (original?.captureMethod !== "static" && original?.captureMethod !== "rendered")) {
      await settle("skipped", null);
      await emitNow(input);
      return { outcome: "skipped", reason: "not_replayable" };
    }

    // Same METHOD as the original, or the two captures are not comparable. A `static`
    // original re-captured with a browser is a different document (the browser runs
    // the JS the fetch never did), so a delta could "fail to reproduce" purely because
    // we looked at it through different glass.
    const { scrapePage, closeScraperBrowsers } = await import("@outrival/scrapers");
    const knownLevel = original.captureMethod === "rendered" ? 1 : 0;
    let capture: Awaited<ReturnType<typeof scrapePage>>;
    try {
      capture = await scrapePage(url, {
        knownLevel,
        egressTier: monitor.egressTier === "datacenter" ? "datacenter" : "direct",
      });
    } catch (err) {
      // A refusal, a block, a timeout, a 404. The site said no, or said nothing: that
      // is OUR problem, never the customer's. Same posture as the faithfulness gate's
      // skipped verdict — an infrastructure failure on the verifier's side must not
      // withhold a signal the pipeline already judged worth sending.
      logger.warn("Verification capture failed — emitting unverified", {
        changeId: input.changeId,
        pass: input.pass,
        error: String(err),
      });
      await settle("skipped", null);
      await emitNow(input);
      return { outcome: "skipped", reason: "capture_failed" };
    } finally {
      await closeScraperBrowsers().catch(() => {});
    }

    const achievedMethod = capture.level >= 1 ? "rendered" : "static";
    if (achievedMethod !== original.captureMethod) {
      await settle("skipped", null);
      await emitNow(input);
      return { outcome: "skipped", reason: "method_mismatch" };
    }

    const text = extractContent(capture.html, monitor.sourceType);

    // P1's grader, applied to the verification capture. The reference median is the
    // ORIGINAL capture's own size rather than the monitor's history: the question here
    // is narrower than "is this page healthy", it is "did we get back something
    // comparable to what produced the change".
    const graded = computeCompleteness({
      textLength: text.length,
      historicalMedian: original.contentSize ?? 0,
      sourceType: monitor.sourceType,
      anchorsFound: countCaptureAnchors(capture.html, monitor.sourceType),
      httpStatus: capture.statusCode ?? 0,
      renderLevelReached: capture.level,
      renderLevelExpected: monitor.requiresLevel ?? 0,
    });
    if (isPartialScore(graded.score)) {
      logger.warn("Verification capture graded partial — emitting unverified", {
        changeId: input.changeId,
        pass: input.pass,
        score: graded.score,
        reasons: graded.reasons,
      });
      await settle("skipped", null);
      await emitNow(input);
      return { outcome: "skipped", reason: "partial_capture" };
    }

    const check = checkDeltaAgainst(text, proof);

    if (!check.reproduced) {
      // SILENT retention. No signal, no "we could not verify this" alert: the next
      // scheduled scrape re-detects the delta if it was ever real. What this DOES do
      // is add an observation to the A/B window, which is where the noise becomes a
      // finding once it has happened twice.
      await settle("not_reproduced", describeCheck(check, proof));
      logger.log("Delta did not reproduce — signal retained", {
        changeId: input.changeId,
        pass: input.pass,
        missingAdded: check.missingAdded.length,
        lingeringRemoved: check.lingeringRemoved.length,
      });
      await maybeEmitAbTestSignal({
        monitorId: monitor.id,
        competitorId: competitor.id,
        competitorUrl: competitor.url,
        sourceType: monitor.sourceType,
        proof,
        now,
      });
      return { outcome: "not_reproduced", pass: input.pass };
    }

    if (input.pass === "quick") {
      // Survived the transient test. The real one waits out the rest of the delay:
      // this pass proves the page is stable, not that the capture was independent.
      await db
        .update(signalVerifications)
        .set({ quickCheckAt: now })
        .where(eq(signalVerifications.id, verification.id));
      await verifySignalDelta.enqueue(
        { ...input, pass: "independent" },
        { startAfter: independentPassDelayMin() * 60 },
      );
      logger.log("Quick check passed — independent capture scheduled", {
        changeId: input.changeId,
        inMinutes: independentPassDelayMin(),
      });
      return { outcome: "pending", pass: "quick" };
    }

    await settle("confirmed", describeCheck(check, proof));
    await emitNow(input);
    logger.log("Delta confirmed by an independent capture", {
      changeId: input.changeId,
      gapMinutes: verification.quickCheckAt
        ? Math.round((now.getTime() - verification.quickCheckAt.getTime()) / 60_000)
        : null,
    });
    return { outcome: "confirmed" };
  } catch (err) {
    if (err instanceof AbortTaskRunError) throw err;
    // A fault in the verifier itself. Logged loudly, and then it does the only
    // defensible thing: emits. The signal was already judged worth sending, and a bug
    // on this path must not be the reason a customer never hears about it.
    logger.error("verify-signal-delta failed — emitting unverified", {
      changeId: input.changeId,
      pass: input.pass,
      error: err instanceof Error ? err.message : String(err),
    });
    await settle("skipped", null);
    await emitNow(input);
    return { outcome: "skipped", reason: "verifier_error" };
  }
}
