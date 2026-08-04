import { logger } from "../lib/job-logger";
import {
  NonRetriable as AbortTaskRunError,
  detectHiringFootprint,
  detectHiringVelocityShifts,
  detectSalaryShifts,
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
import { getFromR2, normalizeDomain, hasDisclosedSalary } from "@outrival/shared";
import { detectAtsPlatform, isApiAdapter, parseAtsIslandFromHtml } from "@outrival/scrapers/jobs-ats";
import {
  bucketJobCounts,
  isoWeekStart,
  tallyHiringGeo,
  tallySalaryBands,
} from "@outrival/scrapers/jobs-hiring";
import { declaredOpenRoles } from "@outrival/scrapers/jobs-signals";
import { detectRemoteMode } from "@outrival/scrapers/jobs-jd-facts";
import { jobsFromStructured } from "@outrival/scrapers/structured-data";
import { htmlToText } from "../lib/html-to-text";
import {
  insertJobCounts,
  upsertHiringGeo,
  upsertHiringMetrics,
  upsertHiringSalaryBands,
  upsertAtsCoverageGap,
  loggedAi,
  logExtractionRun,
  type JobsResolution,
} from "../lib/analytics";
import { rememberAtsBoard } from "../lib/platform-detect";
import { stagedExtract } from "../lib/staged-extract";
import { computeJobsDelta } from "../lib/jobs-delta";
import { stampGeo, stampMissingGeo, tallyResolutions } from "../lib/posting-geo";

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
  // Hiring Intelligence v2 P3 — the period the two amounts are quoted on, from the
  // same ATS payload. Null on every provider that states none, and on the fallback.
  salaryPeriod: string | null;
  // Hiring Intelligence v2 P1 — best-effort, and only ever from the ATS path (the
  // careers-page fallback captures a listing, not the bodies behind it).
  descriptionText: string | null;
  remoteMode: string | null;
  employmentType: string | null;
  // Hiring Intelligence v2 P2 — resolved offline from `location`, never guessed.
  countryCodes: string[] | null;
  geoResolution: string;
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
    const island = parseAtsIslandFromHtml(html);
    const atsJobs = island?.jobs ?? null;

    // Hiring Intelligence v2 P4 — the coverage learning loop. Every jobs run says
    // which platform the board is on and how it was read, so "which ATS adapter is
    // worth writing next" becomes a query instead of a hunch. Best-effort by
    // construction (it goes through the analytics writer), and recorded on EVERY
    // outcome including the ones that resolve nothing — a board we consistently
    // fail to read is the most interesting row in the table.
    const boardHost = normalizeDomain(snapshot.resolvedUrl) ?? "";
    const recordCoverage = (resolution: JobsResolution, jobCount: number) =>
      upsertAtsCoverageGap({
        platform: island?.provider || detectAtsPlatform(html) || "unknown",
        host: boardHost,
        competitor_id: input.competitorId,
        resolution,
        job_count: jobCount,
        recorded_at: new Date(),
      });

    let jobs: NormalizedJob[];
    let resolution: JobsResolution;
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
        salaryPeriod: j.salaryPeriod,
        descriptionText: j.description,
        remoteMode: detectRemoteMode(j.location, j.description),
        employmentType: j.employmentType,
        ...stampGeo(j.location),
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
      // The island names the PLATFORM; whether that platform has a hand-written API
      // adapter is what separates the two AI-free paths. Teamtailor and the long
      // tail land here through schema.org markup, not an API.
      resolution = isApiAdapter(island?.provider ?? "") ? "api_adapter" : "json_ld";
      logger.log("Jobs from structured board (no LLM)", {
        count: jobs.length,
        platform: island?.provider,
        resolution,
      });
      // Remember the board so the next run hits its API directly. This is the only
      // moment the token is ever observed for a board the careers page EMBEDS
      // rather than links — detection reads SSR HTML, where such a board is named
      // nowhere, so without this those competitors pay a browser render every run.
      if (island) await rememberAtsBoard(input.competitorId, island.provider, island.token);
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
        await recordCoverage("none", 0);
        return { ok: false, reason: "parse_failed" };
      }
      // The staged extractor's own structured stage is the same schema.org read,
      // reached from the worker side rather than the scraper's — count it as such.
      resolution = result.resolution === "structured" ? "json_ld" : "ai_fallback";
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
        salaryPeriod: null,
        descriptionText: null,
        // The listing carries no body, so only the location line can answer this.
        remoteMode: detectRemoteMode(j.location, null),
        employmentType: null,
        ...stampGeo(j.location),
      }));
      logger.log("Jobs extracted", { count: jobs.length, resolution: result.resolution });
    }

    await recordCoverage(resolution, jobs.length);

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
          salaryPeriod: j.salaryPeriod,
          descriptionText: j.descriptionText,
          remoteMode: j.remoteMode,
          employmentType: j.employmentType,
          countryCodes: j.countryCodes,
          geoResolution: j.geoResolution,
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

      // Hiring footprint (Hiring Intelligence v2 P2): the same authoritative-run
      // condition, the same weekly upsert — one row per (competitor, country, ISO
      // week) — over the WHOLE active board, not just this run's additions.
      //
      // Postings that were already active when P2 shipped carry no resolution yet,
      // so they are stamped here on the way past. That is a one-time cost per
      // posting (the filter is `geoResolution is null`), which means the feature
      // fills itself in over one scrape cycle even without the backfill command.
      const closed = new Set(closedIds);
      const activeExisting = existing.filter((j) => !closed.has(j.id));
      const stamped = await stampMissingGeo(
        activeExisting.filter((j) => j.geoResolution === null),
      );
      const activeGeo = [
        ...activeExisting.map((j) => stamped.get(j.id) ?? {
          countryCodes: j.countryCodes,
          geoResolution: j.geoResolution,
        }),
        ...inserts.map((j) => ({
          countryCodes: j.countryCodes,
          geoResolution: j.geoResolution,
        })),
      ];
      const geoCounts = tallyHiringGeo(activeGeo);
      await upsertHiringGeo(
        Array.from(geoCounts.entries()).map(([countryCode, count]) => ({
          competitor_id: input.competitorId,
          country_code: countryCode,
          open_count: count,
          week_start: weekStart,
          recorded_at: now,
        })),
      );
      // The learning loop for the offline dataset: what share of a real board it
      // can place. The counts also survive in hiring_geo's reserved rows, so this
      // is queryable after the fact rather than only greppable.
      logger.log("Hiring geo resolved", {
        competitorId: input.competitorId,
        ...tallyResolutions(activeGeo),
      });
      await detectHiringFootprint.enqueue({ competitorId: input.competitorId });

      // Hiring Intelligence v2 P3 — the same weekly upsert, over what the board
      // PAYS. It rides the identical `authoritative` guard for a reason that is
      // sharper here than anywhere else: a degraded fetch returns a SLICE of the
      // board, and the median of a slice is a different number from the median of
      // the board — indistinguishable, downstream, from the competitor changing
      // what it pays.
      //
      // Salaries the bands cannot place (hourly rates, no currency, an amount too
      // small to tell a monthly figure from an annual one) are dropped by
      // tallySalaryBands rather than approximated, so `n` on a row always means
      // "roles this band was actually computed from".
      const activeSalary = [
        ...activeExisting.map((j) => ({
          department: j.department,
          title: j.title,
          salaryMin: j.salaryMin,
          salaryMax: j.salaryMax,
          salaryCurrency: j.salaryCurrency,
          salaryPeriod: j.salaryPeriod,
        })),
        ...inserts.map((j) => ({
          department: j.department,
          title: j.title,
          salaryMin: j.salaryMin,
          salaryMax: j.salaryMax,
          salaryCurrency: j.salaryCurrency,
          salaryPeriod: j.salaryPeriod,
        })),
      ];
      const bands = tallySalaryBands(activeSalary);
      await upsertHiringSalaryBands(
        bands.map((b) => ({
          competitor_id: input.competitorId,
          department_bucket: b.bucket,
          currency: b.currency,
          p25: b.p25,
          p50: b.p50,
          p75: b.p75,
          n: b.n,
          week_start: weekStart,
          recorded_at: now,
        })),
      );
      // A board that publishes nothing has nothing to signal — no band can move and
      // disclosure cannot have started — so it never wakes the detector.
      if (activeSalary.some(hasDisclosedSalary)) {
        await detectSalaryShifts.enqueue({ competitorId: input.competitorId });
      }
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
