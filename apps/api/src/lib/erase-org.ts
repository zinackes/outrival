import { eq, sql } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { deleteManyFromR2, logger } from "@outrival/shared";
import { db } from "./db";
import { getStripe } from "./stripe";

// Permanently erase an org and all of its data (GDPR erasure path). The org row
// cascades most tables; everything holding a non-cascading FK (alerts, signals,
// digests, changes, job_postings, reviews) is torn down explicitly first,
// deepest-first. Best-effort Stripe cancel + R2/analytics cleanup never block the
// erasure (an orphaned Stripe sub or leftover R2 object is recoverable; a
// half-deleted org is not).
//
// `detachUsers`:
//   true  → users are DETACHED (org_id = NULL) before the org goes, so the
//           accounts survive (self-delete from settings — ensureUserOrg gives the
//           user a fresh empty org on their next request).
//   false → users are NOT detached; the org delete cascades the `users` rows away
//           (admin "delete user" — the Better Auth identity is removed separately
//           by the caller).
export async function eraseOrg(
  orgId: string,
  opts: { detachUsers: boolean },
): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return;

  // Stop billing first — best-effort, deletion proceeds regardless.
  if (org.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(org.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err, orgId }, "Stripe cancel failed during org erasure");
    }
  }

  // Capture binary/analytics references before the rows cascade away.
  const snapKeys = (await db.execute(sql`
    SELECT sn.r2_key FROM snapshots sn
    JOIN monitors m ON m.id = sn.monitor_id
    JOIN competitors c2 ON c2.id = m.competitor_id
    WHERE c2.org_id = ${orgId}`)) as unknown as Array<{ r2_key: string }>;
  const cardKeys = (await db.execute(sql`
    SELECT pdf_r2_key FROM battle_cards
    WHERE org_id = ${orgId} AND pdf_r2_key IS NOT NULL`)) as unknown as Array<{
    pdf_r2_key: string;
  }>;
  const competitorIds = (
    (await db.execute(sql`
      SELECT id FROM competitors WHERE org_id = ${orgId}`)) as unknown as Array<{ id: string }>
  ).map((r) => r.id);

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM alerts WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM signals WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM digests WHERE org_id = ${orgId}`);
    await tx.execute(sql`
      DELETE FROM changes WHERE monitor_id IN (
        SELECT m.id FROM monitors m
        JOIN competitors c2 ON c2.id = m.competitor_id
        WHERE c2.org_id = ${orgId})`);
    await tx.execute(sql`
      DELETE FROM job_postings WHERE competitor_id IN (
        SELECT id FROM competitors WHERE org_id = ${orgId})`);
    await tx.execute(sql`
      DELETE FROM reviews WHERE competitor_id IN (
        SELECT id FROM competitors WHERE org_id = ${orgId})`);
    if (opts.detachUsers) {
      await tx.execute(sql`UPDATE users SET org_id = NULL WHERE org_id = ${orgId}`);
    }
    await tx.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
  });

  // Best-effort cleanup of the no-FK analytics history and R2 objects: the
  // workspace is already gone, leftovers are storage cost, never dangling UI.
  try {
    await db.execute(sql`DELETE FROM signal_feed WHERE org_id = ${orgId}`);
    if (competitorIds.length > 0) {
      for (const table of [
        "pricing_history",
        "job_counts",
        "review_scores",
        "numeric_claims",
        "tech_stack_history",
      ] as const) {
        await db.execute(sql`
          DELETE FROM ${sql.identifier(table)}
          WHERE competitor_id = ANY(${competitorIds})`);
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "Analytics cleanup failed during org erasure");
  }
  try {
    const keys = [
      ...snapKeys.map((r) => r.r2_key).filter(Boolean),
      ...snapKeys.map((r) => r.r2_key?.replace(/\.html$/, ".png")).filter(Boolean),
      ...cardKeys.map((r) => r.pdf_r2_key).filter(Boolean),
    ];
    if (keys.length > 0) await deleteManyFromR2(keys);
  } catch (err) {
    logger.error({ err, orgId }, "R2 cleanup failed during org erasure");
  }
}
