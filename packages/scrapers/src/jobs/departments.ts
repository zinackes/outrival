/**
 * Department normalization for hiring velocity (hiring-velocity feature).
 *
 * The taxonomy AND its classifier live in @outrival/shared: web/api can't import
 * scrapers, and the API buckets the raw job_counts labels of a competitor that
 * never had an authoritative ATS run. Re-exported here so
 * `@outrival/scrapers/jobs-hiring` stays the single import for the worker's pure
 * hiring logic; the per-scrape counting below is worker-shaped and stays here.
 */

export {
  DEPARTMENT_BUCKETS,
  DEPARTMENT_BUCKET_LABELS,
  isDepartmentBucket,
  normalizeDepartment,
  type DepartmentBucket,
} from "@outrival/shared";
import { normalizeDepartment, type DepartmentBucket } from "@outrival/shared";

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
