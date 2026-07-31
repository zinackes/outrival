// Pricing Intelligence v2 — Phase 1: turn the deterministic batch diff
// (diffPricingBatches, @outrival/shared) into an actual pricing signal, from
// inside extract-pricing (no new job). scrape-monitor DEFERS a pricing change's
// classify/signal routing here, so exactly one path owns each change:
//
//   batch diff non-empty  → synthesized classification (the fact is established
//                           deterministically; the AI only narrates insight /
//                           so-what / action on it — classify-structured pattern)
//   batch diff empty      → the lexical classifier, iff scrape-monitor judged
//                           the text diff worth it (evaluateSignificance)
//
// Anchor: the deferred change of the same scrape when there is one; otherwise a
// change found by its snapshot (owned by another path — promo skip, pricing
// repositioning — so we stand down); otherwise a synthetic change on the same
// monitor, the review_shift / hiring_shift pattern.

import { desc, eq, and, ne } from "drizzle-orm";
import { db, changes, snapshots } from "@outrival/db";
import { classifyChange, generateSignal } from "@outrival/queue";
import {
  diffPricingBatches,
  maxPricingChangeSeverity,
  sortPricingChanges,
  type PricingBatchRow,
  type PricingChange,
  type PricingChangeSeverity,
} from "@outrival/shared";
import { logger } from "./job-logger";

// The diffText of a synthetic anchor stays readable end-to-end (it feeds the
// insight prompt and the faithfulness gate verbatim).
const MAX_DIFF_LINES = 50;

export interface PricingSignalPlan {
  /** Shape-compatible with @outrival/ai ClassificationSchema (parsed by
   * generate-signal). Severity is the worst band across the typed changes —
   * already deterministic, and still subject to applySeverityGuard downstream. */
  classification: {
    category: "pricing";
    severity: PricingChangeSeverity;
    is_significant: true;
    reason: string;
    humanChangeBefore: string | null;
    humanChangeAfter: string | null;
  };
  /** Fact lines for a synthetic anchor change ("Pro: $79/mo → $59/mo (−25.3%)"),
   * each carrying a price token so a pricing critical survives the guard. */
  diffText: string;
}

/** Pure: a ranked, non-empty typed-change list → the signal to emit. */
export function planPricingSignal(pricingChanges: PricingChange[]): PricingSignalPlan {
  const top = pricingChanges[0]!;
  const severity = maxPricingChangeSeverity(pricingChanges)!;
  const rest = pricingChanges.length - 1;
  return {
    classification: {
      category: "pricing",
      severity,
      is_significant: true,
      reason:
        rest > 0 ? `${top.summary} (+${rest} more pricing change${rest > 1 ? "s" : ""})` : top.summary,
      humanChangeBefore: top.humanBefore,
      humanChangeAfter: top.humanAfter,
    },
    diffText: [
      "Deterministic pricing comparison of the two most recent captures:",
      ...pricingChanges.slice(0, MAX_DIFF_LINES).map((c) => `- ${c.summary}`),
      ...(pricingChanges.length > MAX_DIFF_LINES
        ? [`(${pricingChanges.length - MAX_DIFF_LINES} more changes not shown)`]
        : []),
    ].join("\n"),
  };
}

export interface RoutePricingSignalArgs {
  competitorId: string;
  snapshot: { id: string; monitorId: string; resolvedUrl: string | null };
  previous: PricingBatchRow[] | null;
  current: PricingBatchRow[];
  /** The change scrape-monitor deferred to us; absent on manual re-triggers and
   * no-text-change scrapes. */
  deferredChangeId: string | null;
  /** Whether that change passed evaluateSignificance (lexical fallback gate). */
  lexicalWorth: boolean;
  /** P2 — typed changes from the entitlement matrix diff of the same capture
   * (never critical by construction), merged with the batch diff so one capture
   * emits ONE signal whose top line is the worst move across both axes. */
  entitlementChanges?: PricingChange[];
  /** P3 — typed changes from the volume-ladder diff of the same capture, merged
   * on the same terms. One capture still emits ONE signal. */
  tierChanges?: PricingChange[];
}

/**
 * Route the pricing signal for one live extraction. Never throws: it runs after
 * the non-idempotent pricing_history insert, and a retry of the whole job to
 * re-emit a signal would duplicate the batch — a lost signal on a transient
 * error is the lesser failure (the lexical path stays the safety net next scrape).
 */
export async function routePricingSignal(args: RoutePricingSignalArgs): Promise<
  | { emitted: "deterministic"; changeId: string; severity: PricingChangeSeverity; changes: number }
  | { emitted: "lexical_fallback"; changeId: string }
  | { emitted: "none"; reason: string }
> {
  const fallback = async (reason: string) => {
    if (args.deferredChangeId && args.lexicalWorth) {
      await classifyChange.enqueue({ changeId: args.deferredChangeId });
      return { emitted: "lexical_fallback" as const, changeId: args.deferredChangeId };
    }
    return { emitted: "none" as const, reason };
  };

  try {
    // First scrape: everything is "new", none of it is news. (Entitlement
    // changes can't exist here either — their differ also returns [] on an
    // empty baseline.)
    if (!args.previous || args.previous.length === 0) return await fallback("first_scrape");

    const pricingChanges = sortPricingChanges([
      ...diffPricingBatches(args.previous, args.current),
      ...(args.entitlementChanges ?? []),
      ...(args.tierChanges ?? []),
    ]);
    if (pricingChanges.length === 0) return await fallback("batch_unchanged");

    let anchorChangeId = args.deferredChangeId;
    if (!anchorChangeId) {
      // A change exists for this capture but was NOT deferred to us: another
      // path owns its signal (promo skip, pricing repositioning, or a scrape
      // enqueued by pre-P1 code that already sent it to classify-change).
      const owned = await db.query.changes.findFirst({
        where: eq(changes.snapshotAfterId, args.snapshot.id),
        columns: { id: true },
      });
      if (owned) {
        logger.log("Deterministic pricing diff found but the change is owned elsewhere", {
          competitorId: args.competitorId,
          changeId: owned.id,
          changes: pricingChanges.length,
        });
        return { emitted: "none", reason: "change_owned_elsewhere" };
      }
    }

    const plan = planPricingSignal(pricingChanges);

    if (!anchorChangeId) {
      // No change row at all (the page text did not move, or the prior R2 read
      // failed) yet the extracted batch did: synthesize the anchor, exactly like
      // review_shift / hiring_shift, on the REAL pricing monitor.
      const prior = await db.query.snapshots.findFirst({
        where: and(
          eq(snapshots.monitorId, args.snapshot.monitorId),
          ne(snapshots.id, args.snapshot.id),
        ),
        orderBy: desc(snapshots.scrapedAt),
        columns: { id: true },
      });
      const [synthetic] = await db
        .insert(changes)
        .values({
          monitorId: args.snapshot.monitorId,
          snapshotBeforeId: prior?.id ?? null,
          snapshotAfterId: args.snapshot.id,
          diffText: plan.diffText,
          diffType: "text",
          rawDiff: { pricingChanges },
          summary: plan.classification.reason,
          detectedAt: new Date(),
        })
        .returning();
      if (!synthetic) return { emitted: "none", reason: "synthetic_change_insert_failed" };
      anchorChangeId = synthetic.id;
    } else {
      // classify-change never runs on this change (we own it), so stamp the
      // one-line summary it would have written — Activity change cards read it.
      await db
        .update(changes)
        .set({ summary: plan.classification.reason })
        .where(eq(changes.id, anchorChangeId));
    }

    await generateSignal.enqueue(
      { changeId: anchorChangeId, classification: plan.classification },
      { singletonKey: anchorChangeId },
    );
    logger.log("Deterministic pricing signal emitted", {
      competitorId: args.competitorId,
      changeId: anchorChangeId,
      severity: plan.classification.severity,
      changes: pricingChanges.length,
    });
    return {
      emitted: "deterministic",
      changeId: anchorChangeId,
      severity: plan.classification.severity,
      changes: pricingChanges.length,
    };
  } catch (err) {
    logger.warn("Deterministic pricing signal routing failed (non-fatal)", {
      competitorId: args.competitorId,
      error: String(err),
    });
    return { emitted: "none", reason: "error" };
  }
}
