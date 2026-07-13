// Canonical department buckets for hiring velocity (hiring-velocity feature).
// Data-only taxonomy shared across layers: the worker classifies raw ATS labels
// into these (@outrival/scrapers/jobs-hiring `normalizeDepartment`), the API serves
// per-bucket series, and the web renders per-bucket sparklines. Kept here (not in
// scrapers) because web/api cannot import @outrival/scrapers.

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
