import { db, notifications } from "@outrival/db";
import type { Classification } from "@outrival/ai";

/**
 * Severity of a detected change on the user's own product. "major" flags changes
 * impactful enough that the user's competitive set might need re-evaluating
 * (repositioning, category/audience shifts) — we use the classifier's own severity
 * as the proxy, since the generic text classifier has no dedicated change type.
 */
export function determineSelfChangeSeverity(
  classification: Classification,
): "minor" | "major" {
  if (classification.severity === "high" || classification.severity === "critical") {
    return "major";
  }
  return "minor";
}

/**
 * In-app notification for a change detected on the user's own product. Routed to
 * the "My product" page where the user accepts/modifies/ignores it. Distinct from
 * signal alerts — no signal_feed entry and no email/Slack alert is produced.
 */
export async function notifySelfChange(orgId: string, severity: "minor" | "major") {
  await db.insert(notifications).values({
    orgId,
    type: "self_change",
    title:
      severity === "major"
        ? "Major change detected on your product"
        : "Change detected on your product",
    body: "Review and confirm the update on your My product page.",
    linkUrl: "/dashboard/my-product",
  });
}
