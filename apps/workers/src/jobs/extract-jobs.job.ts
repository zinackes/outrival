import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, snapshots, jobPostings, monitors } from "@outrival/db";
import { extractJobs, summarizeSource, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { insertJobCounts, loggedAi } from "../lib/clickhouse";

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
    const text = htmlToText(html);

    const extracted = await loggedAi("extract_jobs", AI_CONFIG.classification, () =>
      extractJobs(text),
    );
    if (!extracted) {
      logger.warn("Jobs extraction returned null");
      return { ok: false, reason: "parse_failed" };
    }
    logger.log("Jobs extracted", { count: extracted.jobs.length });

    const existing = await db.query.jobPostings.findMany({
      where: and(eq(jobPostings.competitorId, input.competitorId), eq(jobPostings.isActive, true)),
    });
    const existingByKey = new Map(
      existing.map((j) => [jobKey(j.title, j.department ?? "Other"), j]),
    );

    const seenKeys = new Set<string>();
    const inserts: Array<{ title: string; department: string; location: string | null }> = [];
    for (const j of extracted.jobs) {
      const key = jobKey(j.title, j.department);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!existingByKey.has(key)) {
        inserts.push({ title: j.title, department: j.department, location: j.location });
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
    for (const j of extracted.jobs) {
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
    if (extracted.jobs.length > 0 || closedIds.length > 0) {
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
          total: extracted.jobs.length,
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
