import { and, eq, isNull } from "drizzle-orm";
import {
  competitors,
  competitorCandidates,
  notifications,
  organizations,
  insertAiQualityCheck,
} from "@outrival/db";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import { scoreOverlap, buildDiscoveryQuery } from "@outrival/ai";
import {
  buildDetectionBody,
  buildDetectionTitle,
  normalizeHostname,
  resolveDetectionConfig,
} from "@outrival/shared";
import { db } from "./db";

const CANDIDATES_PER_ORG = 20;

export type DetectResult =
  | { ok: true; detected: number }
  | { ok: false; error: "missing_profile" };

export async function detectCandidatesForOrg(orgId: string): Promise<DetectResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org || !org.productProfile) {
    return { ok: false, error: "missing_profile" };
  }

  const cfg = resolveDetectionConfig(org.detectionConfig);
  const excludedHosts = new Set(cfg.excludedDomains);

  await db
    .update(organizations)
    .set({ detectionLastRunAt: new Date() })
    .where(eq(organizations.id, orgId));

  const existing = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
  });
  const existingHosts = new Set<string>();
  for (const c of existing) {
    const h = normalizeHostname(c.url);
    if (h) existingHosts.add(h);
  }

  const seen = await db.query.competitorCandidates.findMany({
    where: eq(competitorCandidates.orgId, orgId),
  });
  const seenUrls = new Set(seen.map((c) => c.url));
  const seenHosts = new Set<string>();
  for (const c of seen) {
    const h = normalizeHostname(c.url);
    if (h) seenHosts.add(h);
  }

  const discovered = await findSimilarCompanies(
    org.productUrl,
    buildDiscoveryQuery(org.productProfile, cfg.keywords),
    CANDIDATES_PER_ORG,
    cfg.excludedDomains,
    cfg.region,
  );
  const fresh = discovered.filter((d) => {
    if (seenUrls.has(d.url)) return false;
    const host = normalizeHostname(d.url);
    if (!host) return false;
    if (existingHosts.has(host)) return false;
    if (seenHosts.has(host)) return false;
    if (excludedHosts.has(host)) return false;
    return true;
  });

  // TEMP debug — à retirer
  console.log("[detect]", {
    orgId,
    discovered: discovered.length,
    freshAfterDedup: fresh.length,
    existingHosts: [...existingHosts],
    seenCount: seen.length,
  });

  if (fresh.length === 0) return { ok: true, detected: 0 };

  const scored = await scoreOverlap(org.productProfile, fresh);
  const scoredByUrl = new Map(scored.map((s) => [s.url, s]));

  // Anti-hallucination (patch-24): persist the call-level grounding + self-check
  // envelope for the overlap scoring (one per discovery run). Best-effort.
  await insertAiQualityCheck({
    aiTask: "score_overlap",
    targetType: "overlap_scoring",
    orgId,
    quality: scored._quality,
  });
  // TEMP debug — à retirer
  console.log("[detect] scores", scored.map((s) => `${s.overlapScore} ${s.url}`));

  const detectedTitles: string[] = [];
  for (const d of fresh) {
    const scoring = scoredByUrl.get(d.url);
    if (!scoring) continue;
    if (scoring.overlapScore <= cfg.minOverlap) continue;

    await db.insert(competitorCandidates).values({
      orgId,
      url: d.url,
      title: d.title,
      overlapScore: scoring.overlapScore,
      reason: scoring.reason,
      status: "new",
    });

    detectedTitles.push(d.title);
  }

  const detected = detectedTitles.length;
  if (detected > 0) {
    await db.insert(notifications).values({
      orgId,
      type: "new_competitor",
      title: buildDetectionTitle(detected),
      body: buildDetectionBody(detectedTitles),
      linkUrl: `/dashboard/candidates`,
    });
  }

  return { ok: true, detected };
}
