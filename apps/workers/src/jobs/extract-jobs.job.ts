import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
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
import { jobsFromStructured } from "@outrival/scrapers/structured-data";
import { htmlToText } from "../lib/html-to-text";
import { insertJobCounts, loggedAi, logExtractionRun } from "../lib/analytics";
import { stagedExtract } from "../lib/staged-extract";

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
}

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
});

function jobKey(title: string, department: string): string {
  return `${title.trim().toLowerCase()}::${department.trim().toLowerCase()}`;
}

export const extractJobsJob = task({
  id: "extract-jobs",
  maxDuration: 180,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
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
      }));
      logger.log("Jobs extracted", { count: jobs.length, resolution: result.resolution });
    }

    const existing = await db.query.jobPostings.findMany({
      where: and(eq(jobPostings.competitorId, input.competitorId), eq(jobPostings.isActive, true)),
    });
    const existingByKey = new Map(
      existing.map((j) => [jobKey(j.title, j.department ?? "Other"), j]),
    );

    const seenKeys = new Set<string>();
    const inserts: NormalizedJob[] = [];
    for (const j of jobs) {
      const key = jobKey(j.title, j.department);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!existingByKey.has(key)) {
        inserts.push(j);
      }
    }

    const closedIds = existing
      .filter((j) => !seenKeys.has(jobKey(j.title, j.department ?? "Other")))
      .map((j) => j.id);

    const now = new Date();

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

    const countsByDept = new Map<string, number>();
    for (const j of jobs) {
      countsByDept.set(j.department, (countsByDept.get(j.department) ?? 0) + 1);
    }

    await insertJobCounts(
      Array.from(countsByDept.entries()).map(([department, count]) => ({
        competitor_id: input.competitorId,
        department,
        count,
        recorded_at: now,
      })),
    );

    // First scrape (no prior active postings) has no diff to classify — give the
    // hiring tab a readable state. previousTotal=null marks the initial capture.
    if (jobs.length > 0 || closedIds.length > 0) {
      const closedTitles = existing
        .filter((j) => closedIds.includes(j.id))
        .map((j) => j.title);
      const summary = await loggedAi("source_summary", AI_CONFIG.classification, () =>
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
      );
      if (summary) {
        await db
          .update(monitors)
          .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
          .where(eq(monitors.id, snapshot.monitorId));
      }
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
  },
});
