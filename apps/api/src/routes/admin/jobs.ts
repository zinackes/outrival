import { Hono } from "hono";
import type { AdminVariables } from "./shared";
import { getJob, listJobs, listDeadLetter, redriveDeadLetter } from "../../lib/queue-admin";

export const jobsRouter = new Hono<{ Variables: AdminVariables }>();

// Every job that ran, not just scrape/AI — read from the pg-boss schema (replaces
// the Trigger.dev run list). `taskIdentifier` keeps its name: it holds the queue
// name, which is what the /admin filter has always meant by it.
jobsRouter.get("/jobs", async (c) => {
  const statusParam = c.req.query("status"); // CSV of pg-boss states
  const taskParam = c.req.query("task");
  const before = c.req.query("before"); // cursor: createdAt of the last row seen

  const rows = await listJobs({
    name: taskParam,
    states: statusParam ? statusParam.split(",") : undefined,
    before,
    limit: 25,
  });

  if (!rows) return c.json({ runs: [], nextCursor: null, error: "queue_unavailable" });
  // A full page means there may be more; the cursor is its oldest createdAt.
  const nextCursor = rows.length === 25 ? (rows[rows.length - 1]?.createdAt ?? null) : null;
  return c.json({ runs: rows, nextCursor });
});

// Dead-letter queue: jobs that exhausted their retries. Declared before /jobs/:id
// so "dlq" is not parsed as a job id.
jobsRouter.get("/jobs/dlq", async (c) => {
  const rows = await listDeadLetter(50);
  if (!rows) return c.json({ rows: [], error: "queue_unavailable" });
  return c.json({ rows });
});

// Move dead-lettered jobs back onto their original queues, oldest first.
jobsRouter.post("/jobs/dlq/redrive", async (c) => {
  const moved = await redriveDeadLetter(100);
  if (moved === null) return c.json({ error: "queue_unavailable" }, 503);
  return c.json({ moved });
});

jobsRouter.get("/jobs/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Not found" }, 404);
  return c.json({ run: job });
});
