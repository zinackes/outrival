// Canonical department buckets for hiring velocity (hiring-velocity feature).
// Data-only taxonomy shared across layers: the worker classifies raw ATS labels
// into these (`normalizeDepartment`, re-exported by @outrival/scrapers/jobs-hiring),
// the API serves per-bucket series, and the web renders per-bucket sparklines. Kept
// here (not in scrapers) because web/api cannot import @outrival/scrapers — and the
// API reads it too, to bucket the raw labels of a competitor that never had an
// authoritative ATS run.

export const DEPARTMENT_BUCKETS = [
  "engineering",
  "product",
  "design",
  "data_ml",
  "sales",
  "marketing",
  "customer_success",
  "ops_ga",
  "unknown",
] as const;

export type DepartmentBucket = (typeof DEPARTMENT_BUCKETS)[number];

// Human labels for the UI (sparkline rows / tooltips). English only.
export const DEPARTMENT_BUCKET_LABELS: Record<DepartmentBucket, string> = {
  engineering: "Engineering",
  product: "Product",
  design: "Design",
  data_ml: "Data / ML",
  sales: "Sales",
  marketing: "Marketing",
  customer_success: "Customer Success",
  ops_ga: "Ops / G&A",
  unknown: "Other",
};

export function isDepartmentBucket(x: string): x is DepartmentBucket {
  return (DEPARTMENT_BUCKETS as readonly string[]).includes(x);
}

// There is NO shared taxonomy across ATS providers: the same team reads as "R&D",
// "Technology" or "Engineering"; Lever often leaves `department` empty and carries
// the real signal on `team`; a title alone ("Senior Data Scientist") may be the only
// clue. The rules below map a raw (department, team, title) onto the buckets above so
// per-department hiring stays comparable competitor-to-competitor. PURE: no I/O, no
// AI — a deterministic label map plus a title-keyword fallback. `unknown` is a real,
// counted bucket (its share is a data-quality tell).
//
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
