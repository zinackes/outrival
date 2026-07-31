import { pgTable, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// How to drive ONE competitor's public pricing calculator (Pricing Intelligence
// P4) — the same "cache de parser" idea as parser_extractors, applied to an
// interaction instead of an extraction: the quantity control's selector, the
// total's selector, and the canonical meter the control moves.
//
// Keyed by competitor, NOT domain (unlike parser_extractors). A calculator is
// bound to a plan and a meter, and the same vendor can publish several — a
// per-domain cache would hand one competitor's slider recipe to another
// competitor's page and measure the wrong meter under a shared key.
//
// Written after a probe that VALIDATED (the control moved a total we could read),
// so a cached spec is always one that worked at least once. `spec` is left
// untyped here and cast to CalculatorSpec (@outrival/shared) at the call site,
// matching the jsonb convention used across the schema.
export const calculatorSpecs = pgTable(
  "calculator_specs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id").notNull(),
    /** The page the spec was discovered on — a spec is only replayed there. */
    url: text("url").notNull(),
    /** CalculatorSpec (@outrival/shared): { version, control, total }. */
    spec: jsonb("spec").notNull(),
    version: integer("version").notNull().default(1),
    /** How many times the AI heal step has (re)generated this spec. */
    healCount: integer("heal_count").notNull().default(0),
    /** Consecutive probes where the cached selectors no longer resolved. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Last probe where replaying this spec produced a believed series. */
    lastValidatedAt: timestamp("last_validated_at"),
    /** Last time the heal step tried to (re)generate it — drives the cooldown. */
    lastHealAttemptAt: timestamp("last_heal_attempt_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calculator_specs_competitor_idx").on(t.competitorId)],
);
