import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

export const healthRouter = new Hono();

// Liveness — proves the process is running. Touches no dependency, so uptime
// monitors can ping this without amplifying load on the DB.
healthRouter.get("/", (c) => c.json({ status: "ok", service: "outrival-api" }));
healthRouter.get("/live", (c) => c.json({ status: "ok" }));

// Readiness — proves the service can serve real traffic by checking the database.
healthRouter.get("/ready", async (c) => {
  const checks: Record<string, boolean> = { db: false };

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  const ok = checks.db;
  return c.json({ status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});
