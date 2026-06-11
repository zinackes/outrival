import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const jobPostings = pgTable("job_postings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  title: text("title").notNull(),
  department: text("department"),
  location: text("location"),
  url: text("url"),
  // patch-32 hiring enrichment — populated from the structured ATS API path
  // (Greenhouse/Lever/Ashby/Personio/…), null on the LLM/careers-page fallback.
  // seniority is one of the canonical SENIORITY_LEVELS; postedAt is the ATS
  // publish date; salary is the normalized range (a budget/seniority signal).
  seniority: text("seniority"),
  postedAt: timestamp("posted_at"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  salaryCurrency: text("salary_currency"),
  isActive: boolean("is_active").notNull().default(true),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
}, (t) => [
  // extract-jobs diffs the active postings of one competitor on every run.
  index("job_postings_competitor_active_idx").on(t.competitorId, t.isActive),
]);
