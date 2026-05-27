import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getClickhouse } from "@outrival/db";
import { db } from "../lib/db";

export const healthRouter = new Hono();

// Liveness — proves the process is running. Touches no dependency, so uptime
// monitors can ping this without amplifying load on DB / ClickHouse.
healthRouter.get("/", (c) => c.json({ status: "ok", service: "outrival-api" }));
healthRouter.get("/live", (c) => c.json({ status: "ok" }));

// Readiness — proves the service can serve real traffic. Each dependency check
// is short-circuited and best-effort; ClickHouse is skipped if not configured
// (it's optional in dev).
healthRouter.get("/ready", async (c) => {
  const checks: Record<string, boolean | "skipped"> = {
    db: false,
    clickhouse: "skipped",
  };

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  if (process.env.CLICKHOUSE_URL) {
    try {
      const result = await getClickhouse().ping();
      checks.clickhouse = result.success;
    } catch {
      checks.clickhouse = false;
    }
  }

  const required = [checks.db];
  const optional = [checks.clickhouse];
  const requiredOk = required.every((v) => v === true);
  const optionalOk = optional.every((v) => v === true || v === "skipped");
  const ok = requiredOk && optionalOk;
  return c.json({ status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});
