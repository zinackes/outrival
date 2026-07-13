/**
 * Department normalization for hiring velocity (hiring-velocity feature).
 *
 * There is NO shared taxonomy across ATS providers: the same team reads as "R&D",
 * "Technology" or "Engineering"; Lever often leaves `department` empty and carries
 * the real signal on `team`; a title alone ("Senior Data Scientist") may be the
 * only clue. This maps a raw (department, team, title) onto a small canonical set
 * of buckets so per-department hiring velocity stays comparable competitor-to-
 * competitor. PURE: no I/O, no AI — a deterministic label map plus a title-keyword
 * fallback. `unknown` is a real, counted bucket (its share is a data-quality tell).
 */

// The canonical bucket taxonomy lives in @outrival/shared (web/api can't import
// scrapers). Re-exported here so `@outrival/scrapers/jobs-hiring` stays the single
// import for the worker's pure hiring logic.
export {
  DEPARTMENT_BUCKETS,
  DEPARTMENT_BUCKET_LABELS,
  isDepartmentBucket,
  type DepartmentBucket,
} from "@outrival/shared";
import type { DepartmentBucket } from "@outrival/shared";

// Ordered rules, most-specific FIRST. A raw label / title is scanned top-to-bottom
// and the first bucket whose keywords hit wins, so the ordering encodes precedence:
//   - data_ml before engineering  → "ML Engineer" / "Data Engineer" → data_ml, not engineering
//   - design & marketing before product → "Product Designer" → design, "Product Marketing" → marketing
//   - customer_success before ops_ga → "Customer Support" → customer_success, not a generic ops bucket
//   - sales before engineering → "Sales Engineer" / "Solutions Engineer" → sales
// Single-word keywords match on token boundaries (so "ae" / "ml" don't hit inside
// "aerospace" / "html"); multi-word keywords match as substrings on normalized text.
const BUCKET_RULES: ReadonlyArray<readonly [DepartmentBucket, readonly string[]]> = [
  [
    "data_ml",
    [
      "data science", "data scientist", "machine learning", "ml engineer", "ml ops",
      "mlops", "ai engineer", "applied scientist", "research scientist", "deep learning",
      "data engineer", "data engineering", "analytics engineer", "data analyst",
      "data platform", "data & analytics", "ai/ml", "artificial intelligence",
    ],
  ],
  [
    "design",
    [
      "design", "designer", "ux", "ui", "user experience", "user research",
      "ux research", "creative", "brand studio", "content design",
    ],
  ],
  [
    "marketing",
    [
      "marketing", "growth", "demand generation", "demand gen", "content",
      "brand", "seo", "sem", "communications", "public relations", "social media",
      "lifecycle", "product marketing",
    ],
  ],
  [
    "customer_success",
    [
      "customer success", "customer support", "customer experience", "customer care",
      "client success", "support", "csm", "onboarding", "implementation",
      "professional services", "technical support",
    ],
  ],
  [
    "sales",
    [
      "sales", "account executive", "account exec", "ae", "sdr", "bdr",
      "business development", "revenue", "go to market", "gtm", "account manager",
      "solutions engineer", "sales engineer", "partnerships", "channel",
    ],
  ],
  [
    "product",
    [
      "product management", "product manager", "product owner", "pm",
      "product lead", "product analyst", "group product",
    ],
  ],
  [
    "engineering",
    [
      "engineering", "engineer", "developer", "software", "backend", "front end",
      "frontend", "full stack", "fullstack", "devops", "sre", "site reliability",
      "platform", "infrastructure", "security engineer", "qa", "test engineer",
      "mobile", "ios", "android", "r&d", "research and development", "technology",
      "technical", "architect",
    ],
  ],
  [
    "ops_ga",
    [
      "operations", "ops", "finance", "accounting", "legal", "people",
      "human resources", "hr", "talent", "recruiting", "recruiter", "office",
      "administrative", "admin", "information technology", "business operations",
      "general", "g&a", "procurement", "facilities", "workplace", "compliance",
      "strategy", "chief of staff",
    ],
  ],
];

function classify(text: string): DepartmentBucket {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return "unknown";
  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  for (const [bucket, keywords] of BUCKET_RULES) {
    for (const k of keywords) {
      const hit = k.includes(" ") || /[^a-z0-9]/.test(k)
        ? normalized.includes(k)
        : tokens.has(k);
      if (hit) return bucket;
    }
  }
  return "unknown";
}

/**
 * Map a posting onto a canonical department bucket. The explicit ATS field wins:
 * `department` + `team` are classified first; only when that yields `unknown`
 * (empty or unrecognised — common on Lever, where `team` may be blank) do we fall
 * back to the job title. Still `unknown` when nothing matches — never guessed.
 */
export function normalizeDepartment(
  rawDepartment: string | null | undefined,
  rawTeam: string | null | undefined,
  title: string | null | undefined,
): DepartmentBucket {
  const deptBucket = classify(`${rawDepartment ?? ""} ${rawTeam ?? ""}`);
  if (deptBucket !== "unknown") return deptBucket;
  return classify(title ?? "");
}

/**
 * ISO-week key (Monday of the week, UTC) as a sortable "YYYY-MM-DD" string. This is
 * the weekly idempotency bucket for hiring_metrics: every scrape in the same ISO
 * week upserts the same (competitor, bucket, week) row, so a re-run never doubles a
 * data point. Pure and timezone-stable (all UTC).
 */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0=Sun..6=Sat → days since Monday.
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Count postings per canonical bucket for one competitor. Deterministic: the same
 * postings always yield the same `{ bucket → count }`, which (paired with a fixed
 * week key) makes the hiring_metrics upsert idempotent. Buckets with zero postings
 * are omitted.
 */
export function bucketJobCounts(
  jobs: ReadonlyArray<{
    department?: string | null;
    team?: string | null;
    title?: string | null;
  }>,
): Map<DepartmentBucket, number> {
  const counts = new Map<DepartmentBucket, number>();
  for (const j of jobs) {
    const bucket = normalizeDepartment(j.department, j.team, j.title);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return counts;
}
