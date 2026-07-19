// DEV-ONLY — backend for the manual cron trigger console.
// Mounted at /api/dev only when NODE_ENV !== "production" (see index.ts).
// It turns scheduled jobs into on-demand triggers, so delete this file and its
// mount before shipping to production.
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { competitors } from "@outrival/db";
import { authMiddleware } from "../middleware/auth";
import { scrapeTechStack } from "@outrival/queue";
import { enqueueByName, enqueueJob } from "../lib/queue";
import { getJob } from "../lib/queue-admin";
import { db } from "../lib/db";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

// The scheduled jobs (schedules.task) defined in apps/workers/src/jobs. Kept in
// sync by hand — this is a throwaway dev tool, not a registry. `scope` tells the
// user whether the run touches a single org or sweeps all of them; per-org jobs
// carry skip guards (cadence / no signal / min competitors) so a manual run may
// legitimately no-op.
const DEV_CRONS = [
  {
    id: "schedule-scraping",
    label: "Schedule scraping",
    cron: "0 * * * *",
    scope: "global",
    description: "Enqueue every active monitor whose nextRunAt is due.",
  },
  {
    id: "detect-new-competitors",
    label: "Detect new competitors",
    cron: "0 20 * * 0",
    scope: "per-org",
    description:
      "Exa discovery + overlap scoring. Skips orgs with auto-detect off or already run within their cadence.",
  },
  {
    id: "generate-weekly-digest",
    label: "Generate weekly digest",
    cron: "0 8 * * 1",
    scope: "per-org",
    description: "Weekly AI digest email. Skips orgs with no signal this week.",
  },
  {
    id: "analyze-sectoral",
    label: "Analyze sectoral",
    cron: "0 7 * * 1",
    scope: "per-org",
    description:
      "Cross-competitor sectoral signals. Skips orgs below the min competitors / confidence thresholds.",
  },
] as const;

const KNOWN_IDS = new Set<string>(DEV_CRONS.map((c) => c.id));

export const devRouter = new Hono<{ Variables: Variables }>();

devRouter.use("*", authMiddleware);

devRouter.get("/crons", (c) => c.json({ crons: DEV_CRONS }));

devRouter.post("/crons/:id/trigger", async (c) => {
  const id = c.req.param("id");
  if (!KNOWN_IDS.has(id)) return c.json({ error: "unknown_cron" }, 404);

  // Scheduled tasks ignore the payload here — every job's run() reads none, so
  // an empty object is enough to fire a manual run.
  const jobId = await enqueueByName(id);
  return c.json({ runId: jobId });
});

// Force a tech-stack scan for one competitor. Tech stack runs on its own monthly
// cron (schedule-tech-stack, keyed on competitors.techStackScrapedAt), so there's
// no user-facing "Run" for it — this dev-only trigger lets the operator scan on
// demand from the Sources card. Org-scoped so an id from another workspace 404s.
devRouter.post("/competitors/:id/scrape-tech-stack", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, id),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
  if (!competitor) return c.json({ error: "Competitor not found" }, 404);

  const jobId = await enqueueJob(scrapeTechStack, { competitorId: id });
  return c.json({ runId: jobId });
});

// pg-boss has no run-status API, so the console polls the job row directly.
// States: created | active | completed | cancelled | failed.
devRouter.get("/runs/:runId", async (c) => {
  const job = await getJob(c.req.param("runId"));
  if (!job) return c.json({ error: "not_found" }, 404);
  const terminal = ["completed", "cancelled", "failed"].includes(job.status);
  return c.json({
    id: job.id,
    status: job.status,
    isCompleted: terminal,
    isSuccess: job.status === "completed",
    isFailed: job.status === "failed" || job.status === "cancelled",
    durationMs: job.durationMs,
    output: null,
    error: job.error,
  });
});
