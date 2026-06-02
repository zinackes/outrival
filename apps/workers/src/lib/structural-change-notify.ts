import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  structuralChanges,
  competitors,
  organizations,
  notifications,
} from "@outrival/db";
import { getResend, ALERT_FROM } from "./resend";

const WEB_URL = process.env.WEB_URL ?? "https://outrival.io";
const EMAIL_THROTTLE_MS = 30 * 24 * 60 * 60 * 1000; // at most one email / competitor / month

const TYPE_LABEL: Record<string, string> = {
  pivot: "Possible pivot",
  site_dead: "Site appears down",
  acquired: "Possible acquisition",
  category_shift: "Category shift",
};

interface EvidenceShape {
  currentSummary?: string;
  aiReasoning?: string;
}

/**
 * Notify the org about a detected structural change (patch-23): an in-app
 * notification always, plus a proactive email throttled to one per competitor per
 * month. Idempotent-ish — safe to call once per detected row. The user resolves
 * the change explicitly; this only surfaces it.
 */
export async function notifyStructuralChange(structuralChangeId: string): Promise<void> {
  const change = await db.query.structuralChanges.findFirst({
    where: eq(structuralChanges.id, structuralChangeId),
  });
  if (!change) return;

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, change.competitorId),
    columns: { id: true, name: true, orgId: true },
  });
  if (!competitor) return;

  const label = TYPE_LABEL[change.type] ?? "Structural change";
  const evidence = (change.evidence ?? {}) as EvidenceShape;
  const summary = evidence.currentSummary ?? evidence.aiReasoning ?? "";
  const linkUrl = `${WEB_URL}/dashboard/competitors/${competitor.id}`;

  // In-app notification (always).
  await db.insert(notifications).values({
    orgId: competitor.orgId,
    type: "structural_change",
    title: `${competitor.name}: ${label.toLowerCase()} detected`,
    body: summary
      ? `Our analysis suggests ${competitor.name}'s site no longer matches your monitoring profile. ${summary}`
      : `Our analysis suggests ${competitor.name}'s site no longer matches your monitoring profile.`,
    linkUrl,
  });

  // Proactive email — throttled to one per competitor per month.
  const lastEmailed = await db.query.structuralChanges.findFirst({
    where: and(
      eq(structuralChanges.competitorId, competitor.id),
      isNotNull(structuralChanges.emailSentAt),
    ),
    orderBy: desc(structuralChanges.emailSentAt),
    columns: { emailSentAt: true },
  });
  const throttled =
    lastEmailed?.emailSentAt != null &&
    Date.now() - lastEmailed.emailSentAt.getTime() < EMAIL_THROTTLE_MS;
  if (throttled) return;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, competitor.orgId),
    columns: { digestEmail: true },
  });
  if (!org?.digestEmail) return;

  const html = `<div style="font-family: Inter, sans-serif; background: #0a0a0a; color: #fafafa; padding: 24px; border-radius: 6px;">
  <p style="font-size: 12px; color: #a3a3a3; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px;">Structural change detected</p>
  <h2 style="margin: 0 0 12px; font-family: Syne, sans-serif;">${competitor.name}</h2>
  <p style="margin: 0 0 12px;">${label}</p>
  ${summary ? `<p style="color: #d4d4d4; margin: 0 0 16px;">${summary}</p>` : ""}
  <a href="${linkUrl}" style="color: #f59e0b;">Open your dashboard to decide what to do →</a>
</div>`;

  try {
    await getResend().emails.send({
      from: ALERT_FROM,
      to: org.digestEmail,
      subject: `Important change detected at ${competitor.name}`,
      html,
    });
    await db
      .update(structuralChanges)
      .set({ emailSentAt: new Date() })
      .where(eq(structuralChanges.id, change.id));
  } catch {
    // Best-effort: the in-app notification already surfaced the change.
  }
}
