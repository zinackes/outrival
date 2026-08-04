import { desc, eq } from "drizzle-orm";
import { db, messagingVersions } from "@outrival/db";
import {
  derivePositioningCopy,
  isSameMessaging,
  type HomepageCopySource,
  type PositioningCopy,
} from "@outrival/shared";

/**
 * Append the messaging a homepage capture carries, when it differs from the last
 * one we recorded (Positioning Intelligence v2 P1).
 *
 * Called once per LIVE homepage capture, off the structure that capture already
 * parsed — nothing is re-parsed and nothing is re-fetched. It writes exactly one
 * kind of row and emits NO change and NO signal: a tagline move already reaches
 * the reader through the homepage classifier (`hero_headline_changed`), and a
 * second signal for the same rewrite would be a duplicate, not a finding.
 *
 * Comparison is against the LAST STORED version rather than the previous capture,
 * so a page that flips between two wordings (an A/B test, a rotating hero) does
 * not open a new version every time it flips back — it opens one the first time
 * each wording appears, which is what happened.
 */
export async function recordMessagingVersion(args: {
  competitorId: string;
  structure: HomepageCopySource;
  capturedAt: Date;
  snapshotKey: string | null;
}): Promise<PositioningCopy | null> {
  const copy = derivePositioningCopy(args.structure);
  // A hero we failed to read is not a company that stopped saying anything.
  if (!copy.headline) return null;

  const [last] = await db
    .select({
      h1: messagingVersions.h1,
      subheadline: messagingVersions.subheadline,
      primaryCta: messagingVersions.primaryCta,
    })
    .from(messagingVersions)
    .where(eq(messagingVersions.competitorId, args.competitorId))
    .orderBy(desc(messagingVersions.capturedAt))
    .limit(1);

  if (
    last &&
    isSameMessaging(copy, {
      headline: last.h1,
      subheadline: last.subheadline,
      primaryCta: last.primaryCta,
      valueProps: [],
    })
  ) {
    return null;
  }

  await db
    .insert(messagingVersions)
    .values({
      competitorId: args.competitorId,
      h1: copy.headline,
      subheadline: copy.subheadline,
      primaryCta: copy.primaryCta,
      valueProps: copy.valueProps,
      capturedAt: args.capturedAt,
      snapshotKey: args.snapshotKey,
    })
    // Two workers can capture the same monitor at once after a forced re-scan;
    // the unique key decides, and the loser writing nothing is the correct outcome.
    .onConflictDoNothing();

  return copy;
}
