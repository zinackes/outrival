import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  snapshots,
  competitors,
  selfProductChanges,
  type SelfProfile,
  type SelfProfileField,
} from "@outrival/db";
import { extractSelfProfile, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { loggedAi } from "../lib/clickhouse";
import { notifySelfChange } from "../lib/self-changes";

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

/** Human label of a profile field, used in the proposal summary shown to the user. */
const PROFILE_LABELS: Record<string, string> = {
  category: "category",
  audience: "audience",
  valueProp: "value proposition",
  features: "features",
  techStack: "tech stack",
};

/**
 * Canonical form of a stored/extracted profile value, so we can tell whether a freshly
 * detected value matches one we already proposed (or the user already decided on) and
 * must therefore not re-propose / re-notify. Strings are trimmed; lists are normalized
 * order-independently.
 */
function canonValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return JSON.stringify([...v].map((s) => String(s).trim()).sort());
  return JSON.stringify(v ?? null);
}

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

    // Surface divergences on fields the USER edited (sticky): refreshAuto keeps those,
    // so the user would otherwise never learn their live site now says something
    // different. Record each as a pending self_product_changes proposal (changeId null,
    // accept/modify/ignore on the My Product page). Auto-detected fields are excluded —
    // they were just refreshed silently, so there's nothing to ask about.
    type Proposal = {
      field: keyof SelfProfile;
      previous: unknown;
      next: string | string[];
      severity: "minor" | "major";
    };
    const proposals: Proposal[] = [];
    const consider = (
      field: keyof SelfProfile,
      existing: SelfProfileField<string | string[]> | undefined,
      value: string | string[],
      severity: "minor" | "major",
    ) => {
      if (!existing || existing.isFromAutoDetect !== false) return; // user-edited only
      const empty = typeof value === "string" ? isBlank(value) : value.length === 0;
      if (empty) return; // nothing detected → keep prior, don't propose
      if (canonValue(existing.value) === canonValue(value)) return; // no divergence
      proposals.push({ field, previous: existing.value, next: value, severity });
    };
    consider("category", current.category, extracted.category, "major");
    consider("audience", current.audience, extracted.audience, "major");
    consider("valueProp", current.valueProp, extracted.valueProp, "major");
    consider("features", current.features, extracted.features, "minor");
    consider("techStack", current.techStack, extracted.techStack, "minor");

    let recordedSeverity: "minor" | "major" | null = null;
    for (const p of proposals) {
      // Latest profile-divergence proposal for this field (changeId null), whatever its
      // status — drives idempotence + supersedes a stale pending one.
      const last = await db.query.selfProductChanges.findFirst({
        where: and(
          eq(selfProductChanges.selfCompetitorId, competitor.id),
          eq(selfProductChanges.fieldPath, p.field),
          isNull(selfProductChanges.changeId),
        ),
        orderBy: desc(selfProductChanges.detectedAt),
      });
      // Already proposed or decided for this exact detected value → don't nag again.
      if (last && canonValue(last.newValue) === canonValue(p.next)) continue;

      const label = PROFILE_LABELS[p.field] ?? p.field;
      const summary = `Your ${label} on your live site differs from your saved version.`;
      if (last && last.status === "pending") {
        await db
          .update(selfProductChanges)
          .set({
            previousValue: p.previous,
            newValue: p.next,
            summary,
            severity: p.severity,
            detectedAt: new Date(),
          })
          .where(eq(selfProductChanges.id, last.id));
      } else {
        await db.insert(selfProductChanges).values({
          orgId: competitor.orgId,
          selfCompetitorId: competitor.id,
          changeId: null,
          fieldPath: p.field,
          previousValue: p.previous,
          newValue: p.next,
          summary,
          severity: p.severity,
          status: "pending",
        });
      }
      if (p.severity === "major" || recordedSeverity === null) recordedSeverity = p.severity;
    }
    if (recordedSeverity) {
      await notifySelfChange(competitor.orgId, recordedSeverity);
    }

    logger.log("Completed extract-self-profile", {
      competitorId: competitor.id,
      features: extracted.features.length,
      techStack: extracted.techStack.length,
    });
    return { ok: true, features: extracted.features.length, techStack: extracted.techStack.length };
  },
});
