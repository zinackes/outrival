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
  // Hiring Intelligence v2 P1 — the JD body was ALREADY in the ATS responses
  // (Greenhouse is fetched content=true, Workable details=true, Lever/Ashby/
  // Personio/Recruitee carry it) and thrown away for want of a column. It is where
  // the stack they're adopting, the product they haven't announced, and the market
  // they're entering are written down. Stripped to text and capped at
  // MAX_DESCRIPTION_CHARS on insert; null on every provider that doesn't expose a
  // body in its list payload (Workday, iCIMS, WTTJ, SmartRecruiters) and on the
  // LLM/careers fallback — best-effort, never a reason to fail a jobs run.
  descriptionText: text("description_text"),
  // Deterministic reads off (location + description). null = not resolvable, never
  // guessed: "onsite" asserted over silence would fake an RTO signal.
  remoteMode: text("remote_mode"),
  employmentType: text("employment_type"),
  // Stamped once the JD has been through the fact miner, whatever it yielded. A
  // posting with zero facts is otherwise indistinguishable from an unmined one, so
  // without this "new postings only, never re-run" cannot be enforced and every
  // barren JD would be re-sent to the model on every run.
  factsMinedAt: timestamp("facts_mined_at"),
  isActive: boolean("is_active").notNull().default(true),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
}, (t) => [
  // extract-jobs diffs the active postings of one competitor on every run.
  index("job_postings_competitor_active_idx").on(t.competitorId, t.isActive),
]);
