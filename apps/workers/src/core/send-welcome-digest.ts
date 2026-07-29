import { logger } from "../lib/job-logger";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, organizations, competitors, onboardingSessions } from "@outrival/db";
import { renderWelcomeEmail } from "@outrival/shared";
import { sendEmail, ALERT_FROM } from "../lib/resend";
import { stampOnce } from "../lib/onboarding-funnel";

// Lever 5 brick 1 — D0 welcome digest. Fired from onboarding/complete: "here's your
// starting position; we'll email when it moves." Best-effort and idempotency-keyed per
// org at the trigger site, so a re-run of /complete doesn't double-send.
const InputSchema = z.object({ orgId: z.string() });

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/send-welcome-digest.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runSendWelcomeDigest(payload: z.input<typeof InputSchema>) {
    const { orgId } = InputSchema.parse(payload);

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org?.digestEmail) return { skipped: "no_email" };

    const comps = await db
      .select({ name: competitors.name })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          isNull(competitors.deletedAt),
          ne(competitors.type, "self"),
        ),
      );

    const webUrl = process.env.WEB_URL ?? "https://outrival.app";
    const email = renderWelcomeEmail({
      competitorNames: comps.map((c) => c.name),
      dashboardUrl: `${webUrl}/dashboard`,
    });
    await sendEmail({
      from: ALERT_FROM,
      to: org.digestEmail,
      subject: email.subject,
      html: email.html,
    });

    // Cold-start funnel (F2): the sample digest is the landing's "digest the same
    // day" promise. Stamp it once into the latest onboarding session (fired from
    // /complete, so the session is fresh — no recency gate needed). Best-effort.
    try {
      const session = await db.query.onboardingSessions.findFirst({
        where: eq(onboardingSessions.orgId, orgId),
        orderBy: (t, { desc }) => desc(t.startedAt),
      });
      if (session) {
        const next = stampOnce(session.timings, "digest_sample", Date.now());
        if (next) {
          await db
            .update(onboardingSessions)
            .set({ timings: next })
            .where(eq(onboardingSessions.id, session.id));
        }
      }
    } catch (err) {
      logger.warn("digest_sample stamp failed (non-fatal)", { error: String(err) });
    }

    logger.log("Welcome digest sent", { orgId, competitors: comps.length });
    return { ok: true, competitors: comps.length };
}
