import { pgTable, text, timestamp, boolean, real, jsonb, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { changes } from "./changes";
import { organizations } from "./organizations";
import { competitors } from "./competitors";
import { users } from "./users";
import { signalBatches } from "./signal-batches";

export const severityEnum = pgEnum("severity", ["low", "medium", "high", "critical"]);
export const categoryEnum = pgEnum("category", [
  "pricing", "product", "hiring", "reviews", "content", "funding",
  // Developer / AI-agent surface — set deterministically only (llms.txt appearance).
  // Kept in sync with shared SIGNAL_CATEGORIES + the AI ClassificationSchema enum.
  "api_developer",
  // Taxonomy wave 2 (materiality) — company-level moves carved out of "content".
  // Model-chosen, on already-scraped sources (blog/news/changelog).
  "partnerships", "ma", "leadership", "security_compliance", "ads",
]);

export const signals = pgTable("signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeId: text("change_id").notNull().references(() => changes.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  severity: severityEnum("severity").notNull(),
  category: categoryEnum("category").notNull(),
  insight: text("insight").notNull(),
  soWhat: text("so_what"),
  recommendedAction: text("recommended_action"),
  // Human-readable before/after of the main change, in plain language
  // ("Standard · $99/mo" → "Standard · $79/mo"), surfaced in the "Why this
  // insight?" panel. Nullable: pre-patch signals and failed extractions stay
  // null and the UI falls back gracefully (patch-14).
  humanChangeBefore: text("human_change_before"),
  humanChangeAfter: text("human_change_after"),
  // Strategic narrative for significant structured homepage changes (patch-16):
  // a 2-3 sentence contextual explanation, generated only when severity clears
  // HOMEPAGE_NARRATIVE_MIN_SEVERITY. Null for everything else and pre-patch
  // signals → the UI shows just the title (graceful fallback).
  narrative: text("narrative"),
  // Quality feedback actions (patch-21). When a user marks a signal "not useful"
  // it is hidden from their feed (soft, reversible by deleting the feedback). A
  // "too high/low severity" feedback writes severityOverride (+ who) which the UI
  // and downstream display prefer over the AI-classified `severity`.
  hiddenForUserAt: timestamp("hidden_for_user_at"),
  severityOverride: severityEnum("severity_override"),
  severityOverriddenBy: text("severity_overridden_by").references(() => users.id),
  // Notification moderation (patch-26). relevanceScore is the max composite
  // relevance of the structured homepage changes behind this signal (patch-17),
  // persisted here so the per-org threshold (layer 1) and the weekly recalc can
  // reason about it. Null for non-homepage / lexical signals → layer 1 skipped.
  relevanceScore: real("relevance_score"),
  // Materiality sub-scores (0-3 each) the classifier assigned BEFORE any severity
  // was chosen: { decisionImpact, urgency, corroboration }. `severity` above is a
  // deterministic function of these (severityFromMateriality, @outrival/ai) — the
  // model never picks a band itself. Null for signals whose classification was
  // synthesized deterministically (Hacker News, wellknown, sitemap comparison
  // pages, pricing transitions) and for every pre-materiality signal.
  materiality: jsonb("materiality").$type<{
    decisionImpact: number;
    urgency: number;
    corroboration: number;
    // Véracité v2 P4 — the neighbouring signals the corroboration count was taken
    // over, stamped at signal creation so the "Why this insight?" panel can LINK the
    // surfaces instead of restating a score the reader cannot check. Same jsonb
    // column, so nothing to migrate; absent on every pre-P4 signal and on the
    // synthesized paths, and the panel then shows the score alone, as it does today.
    corroborationSources?: Array<{ signalId: string; sourceType: string; at: string }>;
  }>(),
  // Claim-level faithfulness report for the insight (critical/high only): the
  // FaithfulnessReport produced before dispatch — { verdict, ratio, claims,
  // unfaithfulClaims, timings }. `verdict: "blocked"` means the insight was kept
  // in-app but NEVER emailed/Slacked, and the claims are in the review queue.
  // Null for medium/low signals (out of scope) and when the gate is off.
  faithfulness: jsonb("faithfulness"),
  // Deterministic post-hoc grounding of the generated prose (Véracité v2 P3):
  // 'verified'   — every figure and quotation in the insight is in the source;
  // 'unverified' — at least one was not, and the field carrying it was WITHHELD
  //                (the signal still carries its human before/after and fact block);
  // 'skipped'    — the check could not run honestly (no source, truncated reply).
  // Null on every pre-P3 signal and on the synthesized paths that write no prose.
  groundingStatus: text("grounding_status"),
  // The figures/quotations the source did not support, as
  // { kind, text, field }[] — what was withheld, and out of which field. Kept even
  // though the prose is gone: it is the only record of what the model claimed, and
  // the review queue reads it. Null unless groundingStatus = 'unverified'.
  groundingUnverified: jsonb("grounding_unverified").$type<
    Array<{ kind: string; text: string; field?: string }>
  >(),
  // The dispatcher's decision for this signal: the channel it routed to, and —
  // when it was held back from an immediate email — why. The signal feed reads
  // filteredReason to show "N less relevant signals hidden". Both null until the
  // dispatcher runs (and for critical signals, which bypass every filter).
  dispatchedChannel: text("dispatched_channel"),
  filteredReason: text("filtered_reason"),
  filteredAt: timestamp("filtered_at"),
  // Set when this signal was rolled up into a batch (layer 5); the feed then
  // shows the batch instead of the individual signal.
  batchedIntoId: text("batched_into_id").references(() => signalBatches.id),
  // Stamped once a deferred signal (dispatchedChannel = digest_daily) has gone out
  // in a daily digest email — the daily digest job's idempotency marker.
  dailyDigestSentAt: timestamp("daily_digest_sent_at"),
  // patch-28 — products (SKUs) this signal affects, derived deterministically from
  // product_competitors at signal creation (not via AI). A competitor shared by
  // Marketing Hub and Sales Hub tags its signals into both. Empty for orgs with no
  // product associations; the per-product feed filters with `productIds @> [id]`.
  productIds: jsonb("product_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Intel → action loop (Phase B). User-set triage status so a signal's
  // recommended_action becomes trackable. null = untriaged; otherwise one of
  // todo | doing | done | dismissed (validated app-side, no enum to keep the
  // migration additive). The action board = signals where action_status in
  // (todo, doing). See docs/activation-retention.md.
  actionStatus: text("action_status"),
  actionNote: text("action_note"),
  actionUpdatedAt: timestamp("action_updated_at"),
  // Snooze (user triage): hide the signal from the feed until this moment passes,
  // then it reappears on the next poll. Null = not snoozed. The feed filters
  // `snoozed_until IS NULL OR snoozed_until <= now()`. Reversible (set back to null).
  snoozedUntil: timestamp("snoozed_until"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Main signal feed: org-scoped, newest first.
  index("signals_org_created_idx").on(t.orgId, t.createdAt),
  // Competitor detail page: signals of one competitor, newest first.
  index("signals_competitor_created_idx").on(t.competitorId, t.createdAt),
  // Idempotency + race guard: generate-signal / classify-change dedupe by changeId.
  // UNIQUE so two concurrent runs can't create two signals for the same change, and
  // the dedupe check + the changes-FK teardown become index lookups, not seq scans.
  uniqueIndex("signals_change_id_uq").on(t.changeId),
]);
