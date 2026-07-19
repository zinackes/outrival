import { logger } from "../lib/job-logger";
import { z } from "zod";
import { and, eq, ne, isNull, gte, lt } from "drizzle-orm";
import { db, organizations, competitors, signals } from "@outrival/db";
import { renderMonthlyRecapEmail } from "@outrival/shared";
import { getResend, ALERT_FROM } from "../lib/resend";

// Lever 9 — monthly "Competitive Recap" teaser email. Triggered (idempotency-keyed per
// org+month) from generate-daily-digest at each org's local first-of-month morning, so
// no new cron is needed. The email is only the hook: headline numbers + a CTA into the
// in-app Wrapped view. Light queries here (the full recap is assembled by the API for
// the page). Best-effort.
const InputSchema = z.object({
  orgId: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/), // the month that just ended, "YYYY-MM"
});

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/send-monthly-recap.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runSendMonthlyRecap(payload: z.input<typeof InputSchema>) {
    const { orgId, month } = InputSchema.parse(payload);

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org?.digestEmail) return { skipped: "no_email" };

    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y!, m! - 1, 1));
    const end = new Date(Date.UTC(y!, m!, 1));
    const monthLabel = start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    const roster = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          ne(competitors.type, "self"),
        ),
      );
    // No competitors → not a real workspace yet; don't send a "nothing happened" email.
    if (roster.length === 0) return { skipped: "no_competitors" };

    const rows = await db
      .select({
        severity: signals.severity,
        insight: signals.insight,
        relevanceScore: signals.relevanceScore,
        createdAt: signals.createdAt,
        competitorName: competitors.name,
      })
      .from(signals)
      .innerJoin(competitors, eq(signals.competitorId, competitors.id))
      .where(
        and(
          eq(signals.orgId, orgId),
          gte(signals.createdAt, start),
          lt(signals.createdAt, end),
          isNull(competitors.deletedAt),
          ne(competitors.type, "self"),
        ),
      );

    const byComp = new Map<string, number>();
    for (const r of rows) byComp.set(r.competitorName, (byComp.get(r.competitorName) ?? 0) + 1);
    const busiestName = [...byComp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const biggest = [...rows].sort(
      (a, b) =>
        (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
        (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    const webUrl = process.env.WEB_URL ?? "https://outrival.app";
    const email = renderMonthlyRecapEmail({
      monthLabel,
      totalMoves: rows.length,
      competitorsTracked: roster.length,
      busiestName,
      biggestInsight: biggest?.insight ?? null,
      recapUrl: `${webUrl}/dashboard/recap?month=${month}`,
    });
    await getResend().emails.send({
      from: ALERT_FROM,
      to: org.digestEmail,
      subject: email.subject,
      html: email.html,
    });

    logger.log("Monthly recap sent", { orgId, month, moves: rows.length });
    return { ok: true, moves: rows.length };
}
