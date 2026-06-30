import { and, eq, isNull } from "drizzle-orm";
import {
  competitors,
  competitorCandidates,
  notifications,
  organizations,
  insertAiQualityCheck,
} from "@outrival/db";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import { scoreOverlap, buildDiscoveryQuery, selfProfileToDiscoveryProfile } from "@outrival/ai";
import {
  buildDetectionBody,
  buildDetectionTitle,
  normalizeHostname,
  resolveDetectionConfig,
} from "@outrival/shared";
import { db } from "./db";
import { productDiscoveryTarget } from "./products";

const CANDIDATES_PER_ORG = 20;

export type DetectResult =
  | { ok: true; detected: number }
  | { ok: false; error: "missing_profile" | "product_not_found" };

// patch-28 multi-SKU — discovery for one product. Searches on the product's own
// self-profile (auto-refreshed) so each SKU surfaces its own competitors; candidates
// + the run record are tagged with productId. The primary product falls back to the
// org's legacy productProfile/productUrl so existing orgs keep working unchanged.
export async function detectCandidatesForProduct(
  orgId: string,
  productId: string,
): Promise<DetectResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return { ok: false, error: "missing_profile" };

  const target = await productDiscoveryTarget(orgId, productId);
  if (!target) return { ok: false, error: "product_not_found" };

  const profile = selfProfileToDiscoveryProfile(
    target.selfProfile,
    target.isPrimary ? org.productProfile : null,
  );
  const productUrl = target.url ?? (target.isPrimary ? org.productUrl : null);
  if (!profile) return { ok: false, error: "missing_profile" };

  const cfg = resolveDetectionConfig(org.detectionConfig);
  const excludedHosts = new Set(cfg.excludedDomains);

  await db
    .update(organizations)
    .set({ detectionLastRunAt: new Date() })
    .where(eq(organizations.id, orgId));

  // Dedup against every competitor already tracked in the org (don't re-suggest a
  // company we already monitor anywhere), but only against candidates already seen
  // for THIS product — the same company can surface as a candidate for two SKUs.
  const existing = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
  });
  const existingHosts = new Set<string>();
  for (const c of existing) {
    const h = normalizeHostname(c.url);
    if (h) existingHosts.add(h);
  }

  const seen = await db.query.competitorCandidates.findMany({
    where: and(
      eq(competitorCandidates.orgId, orgId),
      eq(competitorCandidates.productId, productId),
    ),
  });
  const seenUrls = new Set(seen.map((c) => c.url));
  const seenHosts = new Set<string>();
  for (const c of seen) {
    const h = normalizeHostname(c.url);
    if (h) seenHosts.add(h);
  }

  const discovered = await findSimilarCompanies(
    productUrl,
    buildDiscoveryQuery(profile, cfg.keywords),
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

  if (fresh.length === 0) return { ok: true, detected: 0 };

  const scored = await scoreOverlap(profile, fresh);
  const scoredByUrl = new Map(scored.map((s) => [s.url, s]));

  // Anti-hallucination (patch-24): persist the call-level grounding + self-check
  // envelope for the overlap scoring (one per discovery run). Best-effort.
  await insertAiQualityCheck({
    aiTask: "score_overlap",
    targetType: "overlap_scoring",
    orgId,
    quality: scored._quality,
  });

  const detectedTitles: string[] = [];
  for (const d of fresh) {
    const scoring = scoredByUrl.get(d.url);
    if (!scoring) continue;
    if (scoring.overlapScore <= cfg.minOverlap) continue;

    await db.insert(competitorCandidates).values({
      orgId,
      productId,
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
      linkUrl: `/dashboard/discovery?product=${productId}`,
    });
  }

  return { ok: true, detected };
}
