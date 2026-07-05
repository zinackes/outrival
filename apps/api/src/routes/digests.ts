import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { digests, signals, competitors, organizations } from "@outrival/db";
import { generateDigest, toMyProductContext, type DigestInputSignal } from "@outrival/ai";
import {
  renderDigestEmail,
  signDigestFeedbackToken,
  signUnsubscribeToken,
  type DigestEmailData,
} from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getResend, ALERT_FROM } from "../lib/resend";

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

  // Both weekly + daily records, newest first. The client tabs by `period`.
  const list = await db.query.digests.findMany({
    where: eq(digests.orgId, orgId),
    orderBy: desc(digests.createdAt),
    limit: 100,
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

  // Reuse an existing unsent weekly preview for the same window (re-click = refresh);
  // never clobber a digest the cron already sent, and never match a daily row.
  const existing = await db.query.digests.findFirst({
    where: and(
      eq(digests.orgId, orgId),
      eq(digests.weekStart, weekStart),
      eq(digests.period, "weekly"),
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
          period: "weekly",
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

// Send (or resend) this digest by email on demand. The weekly cron auto-sends on
// Monday; this gives the user an explicit "Send by email" / "Resend" action from
// the reader so a preview — or an already-sent digest — can be delivered now.
digestsRouter.post("/:id/send", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.id, id), eq(digests.orgId, orgId)),
  });
  if (!digest) return c.json({ error: "Not found" }, 404);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { digestEmail: true },
  });
  const to = org?.digestEmail;
  if (!to) return c.json({ error: "no_recipient" }, 400);

  const isDaily = digest.period === "daily";

  // One-click feedback + unsubscribe links, signed so the email needs no session
  // (patch-21). Degrades to no links when the secret / API base isn't configured.
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "";
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const links = apiBase && secret;
  const feedbackLinks = links
    ? {
        useful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
          { orgId, digestId: digest.id, verdict: "useful" },
          secret,
        )}`,
        notUseful: `${apiBase}/api/digest-feedback?token=${signDigestFeedbackToken(
          { orgId, digestId: digest.id, verdict: "not_useful" },
          secret,
        )}`,
      }
    : undefined;
  const unsubscribeUrl = links
    ? `${apiBase}/api/digest-feedback/unsubscribe?token=${signUnsubscribeToken(orgId, secret)}`
    : undefined;

  const html = renderDigestEmail(
    digest.content as DigestEmailData,
    digest.weekStart,
    digest.weekEnd,
    feedbackLinks,
    unsubscribeUrl,
    isDaily ? "Your daily competitive briefing" : "Your weekly competitive briefing",
  );

  try {
    await getResend().emails.send({
      from: ALERT_FROM,
      to,
      subject: isDaily
        ? "Your Daily Competitive Briefing"
        : `Your Weekly Competitive Briefing — week of ${digest.weekStart}`,
      html,
      ...(unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("Digest send failed", { orgId, digestId: digest.id, err: String(err) });
    return c.json({ error: "send_failed" }, 502);
  }

  const sentAt = new Date();
  await db.update(digests).set({ sentAt }).where(eq(digests.id, digest.id));

  return c.json({ ok: true, sentAt: sentAt.toISOString() });
});
