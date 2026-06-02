import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  db,
  snapshots,
  competitors,
  type SelfProfile,
  type SelfProfileField,
} from "@outrival/db";
import { extractSelfProfile, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { loggedAi } from "../lib/clickhouse";

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
});

// Refresh an auto-detected field with a freshly extracted value, but never touch a
// field the user has edited (isFromAutoDetect === false), and never clobber a prior
// auto value with an empty extraction (nothing detected → keep what we had).
function refreshAuto<T>(
  existing: SelfProfileField<T> | undefined,
  value: T,
  isEmpty: boolean,
): SelfProfileField<T> | undefined {
  if (existing && existing.isFromAutoDetect === false) return existing;
  if (isEmpty) return existing;
  return { value, isFromAutoDetect: true, lastEditedByUserAt: null };
}

/** A string value the extraction couldn't determine (so we keep the prior one). */
const isBlank = (s: string) => s.trim().length === 0;

/**
 * Patch-12: fill the self-competitor's profile from its homepage — category,
 * audience and value proposition (so a re-scan keeps them current) plus features +
 * tech stack (which have no other source). Runs after each homepage scrape of the
 * self product. Auto-detected fields are refreshed; fields the user corrected stay
 * sticky.
 */
export const extractSelfProfileJob = task({
  id: "extract-self-profile",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting extract-self-profile", input);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, input.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
    if (competitor.type !== "self") {
      logger.log("Not a self competitor, skipping", { competitorId: input.competitorId });
      return { ok: false, reason: "not_self" };
    }

    const snapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, input.snapshotId),
    });
    if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);

    const html = await getFromR2(`${snapshot.r2Key}.html`);
    const text = htmlToText(html).slice(0, 8000);

    const extracted = await loggedAi("extract_self_profile", AI_CONFIG.classification, () =>
      extractSelfProfile(text),
    );
    if (!extracted) {
      logger.warn("Self profile extraction returned null");
      return { ok: false, reason: "parse_failed" };
    }

    const current: SelfProfile = competitor.selfProfile ?? {};
    const next: SelfProfile = {
      ...current,
      category: refreshAuto(current.category, extracted.category, isBlank(extracted.category)),
      audience: refreshAuto(current.audience, extracted.audience, isBlank(extracted.audience)),
      valueProp: refreshAuto(current.valueProp, extracted.valueProp, isBlank(extracted.valueProp)),
      features: refreshAuto(current.features, extracted.features, extracted.features.length === 0),
      techStack: refreshAuto(current.techStack, extracted.techStack, extracted.techStack.length === 0),
    };

    await db
      .update(competitors)
      .set({ selfProfile: next, updatedAt: new Date() })
      .where(eq(competitors.id, competitor.id));

    logger.log("Completed extract-self-profile", {
      competitorId: competitor.id,
      features: extracted.features.length,
      techStack: extracted.techStack.length,
    });
    return { ok: true, features: extracted.features.length, techStack: extracted.techStack.length };
  },
});
