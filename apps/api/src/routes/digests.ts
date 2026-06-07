import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { digests, signals, competitors, organizations } from "@outrival/db";
import { generateDigest, toMyProductContext, type DigestInputSignal } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const digestsRouter = new Hono<{ Variables: Variables }>();

digestsRouter.use("*", authMiddleware);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DigestRange = "this_week" | "last_7_days" | "last_30_days";

const GenerateSchema = z.object({
  range: z.enum(["this_week", "last_7_days", "last_30_days"]).optional(),
  // Custom date-range picker: explicit ISO bounds win over `range` when both set.
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// [start, end) signal window for on-demand generation, UTC-aligned like the cron.
function rangeWindow(range: DigestRange): {
  start: Date;
  end: Date;
} {
  const end = new Date();
  if (range === "this_week") {
    const start = new Date(end);
    start.setUTCHours(0, 0, 0, 0);
    const sinceMonday = (start.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    start.setUTCDate(start.getUTCDate() - sinceMonday);
    return { start, end };
  }
  const days = range === "last_30_days" ? 30 : 7;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

digestsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const list = await db.query.digests.findMany({
    where: eq(digests.orgId, orgId),
    orderBy: desc(digests.weekStart),
    limit: 50,
  });
  return c.json({ digests: list });
});

// On-demand digest for the current week / a rolling window. In-app preview only
// (no email): the weekly cron finalizes and emails unsent previews on Monday.
digestsRouter.post("/generate", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => ({}));
  const parsed = GenerateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const { from, to } = parsed.data;
  const { start, end } =
    from && to
      ? { start: new Date(from), end: new Date(to) }
      : rangeWindow(parsed.data.range ?? "this_week");

  const rows = await db
    .select({
      competitor: competitors.name,
      category: signals.category,
      severity: signals.severity,
      insight: signals.insight,
      soWhat: signals.soWhat,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(
      and(
        eq(signals.orgId, orgId),
        gte(signals.createdAt, start),
        lt(signals.createdAt, end),
      ),
    );

  if (rows.length === 0) {
    return c.json({ digest: null, reason: "no_signals" });
  }

  const input: DigestInputSignal[] = rows.map((s) => ({
    competitor: s.competitor,
    category: s.category,
    severity: s.severity,
    insight: s.insight,
    so_what: s.soWhat,
  }));

  // Frame the digest from the org's own product perspective when profiled (P1).
  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { productProfile: true },
  });
  const content = await generateDigest(input, toMyProductContext(orgRow?.productProfile));
  if (!content) {
    return c.json({ error: "generation_failed" }, 502);
  }

  const weekStart = isoDate(start);
  const weekEnd = isoDate(end);

  // Reuse an existing unsent preview for the same window (re-click = refresh);
  // never clobber a digest the cron already sent.
  const existing = await db.query.digests.findFirst({
    where: and(
      eq(digests.orgId, orgId),
      eq(digests.weekStart, weekStart),
      isNull(digests.sentAt),
    ),
  });

  const stored = existing
    ? await db
        .update(digests)
        .set({ content, temperature: content.temperature, weekEnd })
        .where(eq(digests.id, existing.id))
        .returning()
    : await db
        .insert(digests)
        .values({
          orgId,
          weekStart,
          weekEnd,
          content,
          temperature: content.temperature,
        })
        .returning();

  return c.json({ digest: stored[0] });
});

digestsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.id, id), eq(digests.orgId, orgId)),
  });
  if (!digest) return c.json({ error: "Not found" }, 404);

  return c.json({ digest });
});
