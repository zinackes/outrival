import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

// Ask Outrival question/answer history. One row = one complete exchange (the assistant
// is single-turn — see docs/ask-outrival.md), persisted best-effort after the answer is
// emitted so the UI can show a consultable "Recent questions" list. Scoped per user
// within an org: a user only sees the questions they asked. A multi-turn conversation
// model (ask_conversations parent) is deferred until threads exist.

// Mirror of the citations the synthesis emits (agent.ts AskCitation).
export interface AskHistoryCitation {
  type: "competitor" | "signal";
  id: string;
  label: string;
}

// The page context the question was asked from (null when unscoped).
export interface AskHistoryContext {
  label: string;
  competitorId?: string;
}

export const askHistory = pgTable(
  "ask_history",
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
    answer: text("answer").notNull(),
    citations: jsonb("citations").$type<AskHistoryCitation[]>(),
    context: jsonb("context").$type<AskHistoryContext>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The history list query filters by (org, user) and orders by recency.
    index("ask_history_org_user_idx").on(t.orgId, t.userId, t.createdAt),
  ],
);

export type AskHistory = InferSelectModel<typeof askHistory>;
export type NewAskHistory = InferInsertModel<typeof askHistory>;
