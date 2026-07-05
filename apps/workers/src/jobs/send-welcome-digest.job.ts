import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, organizations, competitors } from "@outrival/db";
import { renderWelcomeEmail } from "@outrival/shared";
import { getResend, ALERT_FROM } from "../lib/resend";

// Lever 5 brick 1 — D0 welcome digest. Fired from onboarding/complete: "here's your
// starting position; we'll email when it moves." Best-effort and idempotency-keyed per
// org at the trigger site, so a re-run of /complete doesn't double-send.
const InputSchema = z.object({ orgId: z.string() });

export const sendWelcomeDigestJob = task({
  id: "send-welcome-digest",
  maxDuration: 60,
  retry: { maxAttempts: 1 },

  async run(payload: z.input<typeof InputSchema>) {
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
    await getResend().emails.send({
      from: ALERT_FROM,
      to: org.digestEmail,
      subject: email.subject,
      html: email.html,
    });

    logger.log("Welcome digest sent", { orgId, competitors: comps.length });
    return { ok: true, competitors: comps.length };
  },
});
