import { Hono } from "hono";
import { runs } from "@trigger.dev/sdk/v3";
import { logger } from "@outrival/shared";
import type { AdminVariables } from "./shared";

export const jobsRouter = new Hono<{ Variables: AdminVariables }>();

// --- Trigger.dev runs (every job that ran, not just scrape/AI) ---
jobsRouter.get("/jobs", async (c) => {
  const statusParam = c.req.query("status"); // CSV of RunStatus
  const taskParam = c.req.query("task");
  const after = c.req.query("after");

  const opts: Record<string, unknown> = { limit: 25 };
  if (after) opts.after = after;
  if (taskParam) opts.taskIdentifier = taskParam;
  if (statusParam) opts.status = statusParam.split(",");

  try {
    const page = await runs.list(opts as unknown as Parameters<typeof runs.list>[0]);
    const out = page.data.map((r) => ({
      id: r.id,
      taskIdentifier: r.taskIdentifier,
      status: r.status,
      isTest: r.isTest,
      version: r.version ?? null,
      createdAt: r.createdAt,
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
      durationMs: r.durationMs ?? null,
      costInCents: r.costInCents ?? null,
    }));
    return c.json({ runs: out, nextCursor: page.pagination?.next ?? null });
  } catch (err) {
    logger.error({ err }, "trigger runs.list failed");
    return c.json({ runs: [], nextCursor: null, error: "trigger_unavailable" });
  }
});

jobsRouter.get("/jobs/:id", async (c) => {
  try {
    const r = await runs.retrieve(c.req.param("id"));
    return c.json({
      run: {
        id: r.id,
        taskIdentifier: r.taskIdentifier,
        status: r.status,
        isTest: r.isTest,
        version: r.version ?? null,
        createdAt: r.createdAt,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
        durationMs: r.durationMs ?? null,
        costInCents: r.costInCents ?? null,
        attemptCount: (r as { attemptCount?: number }).attemptCount ?? null,
        error: r.error ? (r.error.message ?? r.error.name ?? "error") : null,
        payload: r.payload ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "trigger runs.retrieve failed");
    return c.json({ error: "Not found" }, 404);
  }
});
