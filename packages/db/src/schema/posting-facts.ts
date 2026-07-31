import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { competitors } from "./competitors";
import { jobPostings } from "./job_postings";

/**
 * Facts mined from a job description (Hiring Intelligence v2 P1).
 *
 * One row per (posting, kind, value): the technology they named, the initiative
 * they described, the market they said they're entering. Every row carries the
 * VERBATIM sentence it came from, and a row whose snippet is not a substring of
 * the JD is dropped code-side before it ever reaches this table — an unsourced
 * fact does not exist. `confidence` is the model's own, kept for calibration; no
 * signal reads it as a threshold.
 *
 * `signalledAt` marks a fact that has been published in a signal. It is what
 * keeps a technology from re-signalling every time a fourth posting cites it,
 * and it is the window the signal's fact block joins on (same read-time
 * attribution the pricing/hiring blocks use — no change_id to backfill).
 */
export const postingFacts = pgTable(
  "posting_facts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    postingId: text("posting_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id),
    /** 'tech' | 'product_hint' | 'team_size' | 'market' | 'language' */
    kind: text("kind").notNull(),
    /** Free text as the model wrote it; `valueKey` is what grouping compares. */
    value: text("value").notNull(),
    /** Lowercased, whitespace-collapsed `value` — the corroboration key. */
    valueKey: text("value_key").notNull(),
    /** Verbatim sentence from the JD. Substring-verified before insert. */
    evidenceSnippet: text("evidence_snippet").notNull(),
    confidence: doublePrecision("confidence"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    signalledAt: timestamp("signalled_at"),
  },
  (t) => [
    // The miner re-inserts nothing: one row per posting/kind/value, so a retried
    // run after a partial write can't double a fact.
    uniqueIndex("posting_facts_posting_kind_value_idx").on(t.postingId, t.kind, t.valueKey),
    // Corroboration reads "every fact of this competitor of this kind".
    index("posting_facts_competitor_kind_idx").on(t.competitorId, t.kind, t.valueKey),
    // The signal fact block reads the facts published in a time window.
    index("posting_facts_signalled_idx").on(t.competitorId, t.signalledAt),
  ],
);
