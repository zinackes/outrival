import { pgTable, text, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
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
    // Single-level threading: a reply points at a ROOT comment, and a root can
    // never point at anything (enforced on the write path). Replies-to-replies
    // would let a thread nest without bound, which is the shape every tool that
    // ships this — Slack, Linear, GitHub review threads — deliberately avoids.
    // Cascade: deleting a root takes its replies with it.
    parentId: text("parent_id").references((): AnyPgColumn => signalComments.id, {
      onDelete: "cascade",
    }),
    // Null = never edited. Stamped by the edit route so the thread can say so
    // rather than silently rewriting what someone read yesterday.
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("signal_comments_signal_idx").on(t.signalId),
    // Replies are always fetched by root when a thread is expanded.
    index("signal_comments_parent_idx").on(t.parentId),
  ],
);

export type SignalComment = InferSelectModel<typeof signalComments>;
export type NewSignalComment = InferInsertModel<typeof signalComments>;
