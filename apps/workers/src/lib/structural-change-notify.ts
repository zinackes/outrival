import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  structuralChanges,
  competitors,
  organizations,
  notifications,
} from "@outrival/db";
import { sendEmail, ALERT_FROM } from "./resend";
import { escapeHtml } from "./escape-html";
import { emailShell, e, t, severityDot } from "./email-shell";
import { emailButton } from "@outrival/shared";

const WEB_URL = process.env.WEB_URL ?? "https://outrival.app";
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

  const html = emailShell(
    `<div style="margin:0 0 10px;">${severityDot("critical")}<span ${e("critical", t("meta", "vertical-align:middle;"))}>Structural change detected</span></div>
  <h1 ${e("text", t("title", "margin:0 0 8px;"))}>${escapeHtml(competitor.name)}</h1>
  <p ${e("text", t("lead", "margin:0 0 12px;"))}>${label}</p>
  ${summary ? `<p ${e("muted", t("body", "margin:0 0 24px;"))}>${escapeHtml(summary)}</p>` : ""}
  ${emailButton(linkUrl, "Open your dashboard to decide what to do →")}`,
    520,
    summary || label,
  );

  try {
    await sendEmail({
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
