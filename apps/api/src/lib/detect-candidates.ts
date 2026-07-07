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

// Exa recall (not a DB cap): over-fetch so well-known rivals that Exa ranks past
// the first page still enter the pool — the overlap score + the on-demand floor
// downstream keep precision.
const CANDIDATES_PER_ORG = 30;

// On-demand discovery (the "add product" wizard's "find competitors" + the Discovery
// page "Refresh") is a REVIEWABLE picklist, not an auto-notify: mirror onboarding,
// which surfaces every scored candidate sorted by overlap and lets the user dismiss
// the weak ones. The org's `minOverlap` (default 65) is the *auto-notification*
// threshold the weekly cron uses; applying it here silently dropped a niche product's
// real competitors (which routinely score 50-64) and made the wizard report "0 found".
// Persist scored candidates above a low sanity floor (drop clearly-unrelated hits),
// best-first, capped to keep the review queue bounded.
const ON_DEMAND_MIN_OVERLAP = 20;
const ON_DEMAND_MAX_CANDIDATES = 15;

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

  // Surface the scored candidates like onboarding does: above a low sanity floor,
  // best-first, capped — not gated by the org's strict notification threshold.
  const ranked = fresh
    .flatMap((d) => {
      const scoring = scoredByUrl.get(d.url);
      return scoring ? [{ d, scoring }] : [];
    })
    .filter((x) => x.scoring.overlapScore > ON_DEMAND_MIN_OVERLAP)
    .sort((a, b) => b.scoring.overlapScore - a.scoring.overlapScore)
    .slice(0, ON_DEMAND_MAX_CANDIDATES);

  const detectedTitles: string[] = [];
  for (const { d, scoring } of ranked) {
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
