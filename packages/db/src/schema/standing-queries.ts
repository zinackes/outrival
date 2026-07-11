import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { severityEnum } from "./signals";
import type { AskHistoryCitation, AskHistoryContext } from "./ask-history";

// Standing queries — a saved Ask Outrival question kept under watch. The question is
// re-evaluated (through the SAME Ask pipeline, via an internal API endpoint) whenever
// a new signal touches the competitors/categories it mentions. Change detection never
// diffs answer text (the LLM rephrases): it compares the SET of cited signal ids; a
// different set is arbitrated by a light LLM judge, and an alert only fires when the
// material change persists 2 consecutive evaluations (pendingCount hysteresis).
// See docs/ask-outrival.md.

export const standingQueries = pgTable(
  "standing_queries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    // Page context the original question was asked from (same shape as ask_history).
    context: jsonb("context").$type<AskHistoryContext>(),
    // Watched entities, extracted ONCE at creation from the saved answer's citations
    // (+ deterministic category keywords in the question). Empty array = wildcard:
    // any competitor / any category of the org matches.
    watchedCompetitorIds: jsonb("watched_competitor_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    watchedCategories: jsonb("watched_categories")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Materiality floor: a triggering signal below this severity never re-evaluates.
    minSeverity: severityEnum("min_severity").notNull().default("low"),
    // Re-evaluation cooldown: at most one evaluation per window, whatever the
    // signal volume (bursts collapse into the next matching trigger).
    cooldownHours: integer("cooldown_hours").notNull().default(6),
    // Current baseline = the answer the user last saw (saved or last alerted).
    currentAnswer: text("current_answer").notNull(),
    currentCitations: jsonb("current_citations")
      .$type<AskHistoryCitation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Sorted signal ids cited by the baseline answer + their sha256 — the whole
    // change-detection substrate (never the answer text).
    currentSignalIds: jsonb("current_signal_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    currentHash: text("current_hash").notNull(),
    // Hysteresis counter: consecutive evaluations judged materially different from
    // the baseline. Alert fires at 2, then the fresh answer becomes the baseline.
    pendingCount: integer("pending_count").notNull().default(0),
    lastEvaluatedAt: timestamp("last_evaluated_at"),
    lastAlertedAt: timestamp("last_alerted_at"),
    // Judge's one-line summary of the last confirmed change (alert body + digest + UI).
    lastChangeSummary: text("last_change_summary"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // evaluate-standing-queries fetches the org's active queries on every trigger.
    index("standing_queries_org_active_idx").on(t.orgId, t.isActive),
    // List + plan-cap count are scoped per (org, user).
    index("standing_queries_org_user_idx").on(t.orgId, t.userId),
  ],
);

export type StandingQuery = InferSelectModel<typeof standingQueries>;
export type NewStandingQuery = InferInsertModel<typeof standingQueries>;
