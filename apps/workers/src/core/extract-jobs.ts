import { logger } from "../lib/job-logger";
import {
  NonRetriable as AbortTaskRunError,
  detectHiringVelocityShifts,
  mineJobFacts,
} from "@outrival/queue";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, snapshots, jobPostings, monitors } from "@outrival/db";
import {
  extractJobs,
  summarizeSource,
  AI_CONFIG,
  JobsSchema,
  type JobsExtraction,
} from "@outrival/ai";
import { getFromR2, normalizeDomain } from "@outrival/shared";
import { parseAtsJobsFromHtml } from "@outrival/scrapers/jobs-ats";
import { bucketJobCounts, isoWeekStart } from "@outrival/scrapers/jobs-hiring";
import { declaredOpenRoles } from "@outrival/scrapers/jobs-signals";
import { detectRemoteMode } from "@outrival/scrapers/jobs-jd-facts";
import { jobsFromStructured } from "@outrival/scrapers/structured-data";
import { htmlToText } from "../lib/html-to-text";
import { insertJobCounts, upsertHiringMetrics, loggedAi, logExtractionRun } from "../lib/analytics";
import { stagedExtract } from "../lib/staged-extract";
import { computeJobsDelta } from "../lib/jobs-delta";

interface NormalizedJob {
  title: string;
  department: string;
  location: string | null;
  url: string | null;
  // patch-32 — present on the structured ATS path, null on LLM/careers fallback.
  seniority: string | null;
  postedAt: Date | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  // Hiring Intelligence v2 P1 — best-effort, and only ever from the ATS path (the
  // careers-page fallback captures a listing, not the bodies behind it).
  descriptionText: string | null;
  remoteMode: string | null;
  employmentType: string | null;
}

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
});

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/extract-jobs.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out call change.
export async function runExtractJobs(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting extract-jobs", input);

    const snapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, input.snapshotId),
    });
    if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);

    const html = await getFromR2(`${snapshot.r2Key}.html`);

    // Structured ATS path: when the jobs scraper resolved postings via a public
    // ATS API (Greenhouse/Lever/Ashby/…), they ride along as a JSON island in the
    // snapshot HTML. Map them straight to job_postings — accurate, carries the
    // apply URL, and skips the extraction LLM call entirely. Otherwise (plain
    // careers/board page) fall back to LLM extraction on the page text.
    const atsJobs = parseAtsJobsFromHtml(html);
    let jobs: NormalizedJob[];
    if (atsJobs) {
      // ATS API island (Greenhouse/Lever/Ashby…): the richest structured-first
      // path — carries the apply URL and skips the LLM. Logged as a structured
      // resolution so the /admin extraction panel counts it (patch-30).
      jobs = atsJobs.map((j) => ({
        title: j.title,
        department: j.department,
        location: j.location,
        url: j.url,
        seniority: j.seniority,
        postedAt: j.postedAt ? new Date(j.postedAt) : null,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency: j.salaryCurrency,
        descriptionText: j.description,
        remoteMode: detectRemoteMode(j.location, j.description),
        employmentType: j.employmentType,
      }));
      await logExtractionRun({
        competitor_id: input.competitorId,
        source_type: "jobs",
        domain: normalizeDomain(snapshot.resolvedUrl) ?? "",
        resolution: "structured",
        extractor_version: 0,
        ai_used: 0,
        recorded_at: new Date(),
      });
      logger.log("Jobs from ATS API (structured, no LLM)", { count: jobs.length });
    } else {
      // No ATS: staged extraction — schema.org JobPosting → cached parser → AI
      // self-heal → direct AI extraction (the floor). stagedExtract logs the run.
      const result = await stagedExtract<JobsExtraction>({
        kind: "jobs",
        sourceType: "jobs",
        competitorId: input.competitorId,
        html,
        url: snapshot.resolvedUrl,
        schema: JobsSchema,
        plausible: (d) => d.jobs.length > 0,
        structuredFn: (h) => jobsFromStructured(h),
        aiFallback: (text) => extractJobs(text),
        aiFallbackTask: "extract_jobs",
        htmlToText,
      });
      if (!result.data) {
        logger.warn("Jobs extraction returned null");
        return { ok: false, reason: "parse_failed" };
      }
      jobs = result.data.jobs.map((j) => ({
        title: j.title,
        department: j.department,
        location: j.location,
        url: null,
        seniority: null,
        postedAt: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        descriptionText: null,
        // The listing carries no body, so only the location line can answer this.
        remoteMode: detectRemoteMode(j.location, null),
        employmentType: null,
      }));
      logger.log("Jobs extracted", { count: jobs.length, resolution: result.resolution });
    }

    // Cross-check the extraction against the count the page itself prints. Every way
    // this pipeline undercounts — a client-paginated board captured on page 1, an AI
    // window that cut the list, a board past its page cap — produces a SHORT list that
    // is otherwise indistinguishable from a complete one, so nothing downstream can
    // flag it: the Hiring tab showed 10 roles for a competitor whose own page said 54.
    // Advisory only (site phrasing is far too varied to gate on), but it turns a silent
    // slice into a line someone can find.
    const declared = declaredOpenRoles(htmlToText(html));
    if (declared !== null && jobs.length < declared * 0.75 && declared - jobs.length >= 5) {
      logger.warn("Extracted far fewer roles than the page advertises", {
        competitorId: input.competitorId,
        snapshotId: input.snapshotId,
        extracted: jobs.length,
        declared,
        path: atsJobs ? "ats" : "page",
      });
    }

    const existing = await db.query.jobPostings.findMany({
      where: and(eq(jobPostings.competitorId, input.competitorId), eq(jobPostings.isActive, true)),
    });

    // C1: only an authoritative ATS board list makes an empty result mean "all
    // postings closed". On the fallback path jobs=[] can only be an AI-floor
    // {jobs:[]} (a timeout / SPA placeholder / no-data) — never real closure — so
    // computeJobsDelta returns skip:true and we no-op instead of mass-closing.
    const authoritative = atsJobs !== null;
    const delta = computeJobsDelta(existing, jobs, authoritative);
    if (delta.skip) {
      logger.warn("Empty non-authoritative jobs extraction — skipping close/summary", {
        competitorId: input.competitorId,
        snapshotId: input.snapshotId,
      });
      return { ok: false, reason: "empty_unverified" };
    }
    const { inserts, closedIds } = delta;

    const now = new Date();

    const countsByDept = new Map<string, number>();
    for (const j of jobs) {
      countsByDept.set(j.department, (countsByDept.get(j.department) ?? 0) + 1);
    }
    const closedTitles = existing.filter((j) => closedIds.includes(j.id)).map((j) => j.title);

    // First scrape (no prior active postings) has no diff to classify — give the
    // hiring tab a readable state. previousTotal=null marks the initial capture.
    // Retry-safety: run the throwing AI call (and the monitor update it feeds)
    // BEFORE the non-idempotent writes below, so a retried run after an AI
    // failure never leaves duplicate postings/counts behind.
    if (jobs.length > 0 || closedIds.length > 0) {
      const summary = await loggedAi(
        "source_summary",
        AI_CONFIG.classificationFast,
        () =>
          summarizeSource({
            kind: "jobs",
            departments: Array.from(countsByDept.entries()).map(([department, count]) => ({
              department,
              count,
            })),
            total: jobs.length,
            added: inserts.map((j) => j.title),
            closed: closedTitles,
            previousTotal: existing.length > 0 ? existing.length : null,
          }),
        { competitorId: input.competitorId },
      );
      if (summary) {
        await db
          .update(monitors)
          .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
          .where(eq(monitors.id, snapshot.monitorId));
      }
    }

    if (inserts.length > 0) {
      await db.insert(jobPostings).values(
        inserts.map((j) => ({
          competitorId: input.competitorId,
          title: j.title,
          department: j.department,
          location: j.location,
          url: j.url,
          seniority: j.seniority,
          postedAt: j.postedAt,
          salaryMin: j.salaryMin,
          salaryMax: j.salaryMax,
          salaryCurrency: j.salaryCurrency,
          descriptionText: j.descriptionText,
          remoteMode: j.remoteMode,
          employmentType: j.employmentType,
          isActive: true,
          detectedAt: now,
        })),
      );
    }

    if (closedIds.length > 0) {
      await db
        .update(jobPostings)
        .set({ isActive: false, closedAt: now })
        .where(and(inArray(jobPostings.id, closedIds), isNull(jobPostings.closedAt)));
    }

    await insertJobCounts(
      Array.from(countsByDept.entries()).map(([department, count]) => ({
        competitor_id: input.competitorId,
        department,
        count,
        recorded_at: now,
      })),
    );

    // Hiring velocity (hiring-velocity feature): only an authoritative ATS board
    // gives a trustworthy per-week open-count (the LLM/careers fallback can be
    // partial). Bucket the postings into canonical departments and upsert one row
    // per (competitor, bucket, ISO week) — a re-scan the same week overwrites rather
    // than doubles — then fire the inflection detector. job_counts above is left
    // untouched (raw department, per-scrape) so nothing existing regresses.
    if (authoritative && jobs.length > 0) {
      const bucketCounts = bucketJobCounts(jobs);
      const weekStart = isoWeekStart(now);
      const unknown = bucketCounts.get("unknown") ?? 0;
      if (unknown / jobs.length > 0.2) {
        logger.warn("High share of unbucketed hiring departments — mapping may need tuning", {
          competitorId: input.competitorId,
          unknown,
          total: jobs.length,
        });
      }
      await upsertHiringMetrics(
        Array.from(bucketCounts.entries()).map(([bucket, count]) => ({
          competitor_id: input.competitorId,
          department_bucket: bucket,
          open_count: count,
          week_start: weekStart,
          recorded_at: now,
        })),
      );
      await detectHiringVelocityShifts.enqueue({ competitorId: input.competitorId });
    }

    // Hiring Intelligence v2 P1 — mine the JD bodies of the postings we just
    // inserted. Event-driven off this run (no cron slot), and only when something
    // NEW landed WITH a body: re-reading the same descriptions costs AI calls and
    // can produce nothing new by construction. The job itself re-checks which
    // postings are unmined, so a duplicate enqueue is a no-op rather than a
    // double charge.
    if (inserts.some((j) => j.descriptionText)) {
      await mineJobFacts.enqueue({ competitorId: input.competitorId });
    }

    logger.log("Completed extract-jobs", {
      competitorId: input.competitorId,
      inserted: inserts.length,
      closed: closedIds.length,
      departments: countsByDept.size,
    });
    return {
      ok: true,
      inserted: inserts.length,
      closed: closedIds.length,
      departments: countsByDept.size,
    };
}
