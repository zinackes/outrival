import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { changes } from "./changes";
import { competitors } from "./competitors";
import { monitors } from "./monitors";
import { signals } from "./signals";

/**
 * The double-capture ledger (Véracité Intelligence v2 P2).
 *
 * A high-stakes signal is not emitted on the strength of one fetch. Between the
 * change being judged worth a signal and the signal actually existing, the page is
 * re-captured twice: a quick check that kills transients (a partial render, an
 * error page), then an INDEPENDENT capture half an hour later. The delay is the
 * whole mechanism — a re-fetch a second later reads the same CDN object, the same
 * A/B bucket, the same half-finished deploy, so it proves nothing.
 *
 * One row per change (unique below): the row IS the dedup for the verify job, since
 * pg-boss `standard` queues ignore singletonKey (plans/004) and an application key
 * is the only one that actually holds.
 *
 * The row also outlives its verdict on purpose. `not_reproduced` rows are what the
 * A/B detector counts: two of them in fourteen days on the same page, carrying the
 * same delta or its exact inverse, is a competitor running a test — which is the
 * point where the noise stops being noise and becomes the finding.
 */
export const signalVerifications = pgTable(
  "signal_verifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** Stable hash of the normalised added + removed excerpts. Two changes carrying
     * the same delta share it; a flip back carries its INVERSE (see isInverse). */
    deltaFingerprint: text("delta_fingerprint").notNull(),
    /** The delta as it read at detection — the excerpts, not the page. */
    firstExcerpt: text("first_excerpt").notNull(),
    /** The same excerpts as the independent capture served them. Null until that
     * capture runs (and on every outcome that never reached it). */
    secondExcerpt: text("second_excerpt"),
    quickCheckAt: timestamp("quick_check_at"),
    independentCheckAt: timestamp("independent_check_at"),
    /**
     *   pending        — waiting on a pass.
     *   confirmed      — both captures served the same delta; the signal was emitted.
     *   not_reproduced — a capture did not serve it. SILENT: the signal is dropped,
     *                    never downgraded to a "could not verify" alert. The next
     *                    scheduled scrape re-detects it if it was real.
     *   skipped        — the verification itself failed (refused, error, partial).
     *                    The signal is emitted anyway, unbadged: an infrastructure
     *                    failure on OUR side must never withhold a customer's signal.
     *                    Same posture as the faithfulness gate's skipped verdict.
     */
    outcome: text("outcome").notNull().default("pending"),
    /** 1 once the signal was actually inserted, so "verified and emitted" is
     * distinguishable from "verified and then lost to a crash". */
    emitted: integer("emitted").notNull().default(0),
    signalId: text("signal_id").references(() => signals.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    // The dedup key: one verification lifecycle per change, enforced by the DB so two
    // concurrent generate-signal runs cannot both open one (and both enqueue a verify).
    uniqueIndex("signal_verifications_change_id_uq").on(t.changeId),
    // The A/B window: not_reproduced rows for one page, newest first.
    index("signal_verifications_monitor_recorded_idx").on(
      t.competitorId,
      t.monitorId,
      t.recordedAt,
    ),
    // The flap lookup: "has this exact delta already failed to reproduce recently".
    index("signal_verifications_fingerprint_recorded_idx").on(t.deltaFingerprint, t.recordedAt),
  ],
);
