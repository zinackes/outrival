import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

// Alert conditions (OUT-192) — what THIS org considers worth stopping for, written in
// their own words: "price drops below $50", "adds SSO to the free tier", "hires a VP
// of Sales in EMEA". Every signal is checked against the active conditions at creation
// (matchAlertConditions, @outrival/ai) and the matched ids land on signals.matched_condition_ids,
// which is what flips the importance flag and lets the feed filter by condition.
//
// Deliberately NOT standing queries. A standing query is a saved Ask question whose
// ANSWER is re-derived on a schedule; a condition is a predicate evaluated once per
// signal, at the moment the signal exists. The two look alike and behave nothing alike,
// so they stay separate tables — see docs/ask-outrival.md for the other one.

export const alertConditions = pgTable(
  "alert_conditions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Who wrote it. Conditions are org-wide (everyone's feed is flagged by them);
    // the author is kept so the settings list can say where a rule came from.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The user's own sentence, verbatim. It is shown back to them as the reason a
    // signal was flagged, so it is never rewritten, normalized, or "improved".
    condition: text("condition").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // How the rule is doing, so the settings list can answer the only question a
    // saved rule ever raises: is this firing, and when did it last fire? Counted at
    // match time rather than derived, because the derivation is a scan of signals.
    matchCount: integer("match_count").notNull().default(0),
    lastMatchedAt: timestamp("last_matched_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Signal generation loads the org's active conditions on every signal it writes.
    index("alert_conditions_org_active_idx").on(t.orgId, t.isActive),
  ],
);

export type AlertCondition = InferSelectModel<typeof alertConditions>;
export type NewAlertCondition = InferInsertModel<typeof alertConditions>;
