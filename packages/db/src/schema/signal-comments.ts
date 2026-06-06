import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { signals } from "./signals";
import { organizations } from "./organizations";
import { users } from "./users";

// Threaded comments on a signal (Phase C). Works single-user today; `author_name`
// is denormalised so the thread reads naturally once multiUser (Phase 10) lands.
// No @mentions/assignment yet. See docs/distribution-team.md.
export const signalComments = pgTable(
  "signal_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("signal_comments_signal_idx").on(t.signalId)],
);

export type SignalComment = InferSelectModel<typeof signalComments>;
export type NewSignalComment = InferInsertModel<typeof signalComments>;
