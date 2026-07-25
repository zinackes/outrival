import { logger } from "../lib/job-logger";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import {
  db,
  competitors,
  competitorCandidates,
  notifications,
  organizations,
  products,
  insertAiQualityCheck,
} from "@outrival/db";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import {
  scoreOverlap,
  nameKnownCompetitors,
  buildDiscoveryQuery,
  selfProfileToDiscoveryProfile,
} from "@outrival/ai";
import {
  buildDetectionBody,
  buildDetectionTitle,
  resolveDetectionConfig,
  DETECTION_MIN_INTERVAL_MS,
} from "@outrival/shared";

const CANDIDATES_PER_PRODUCT = 20;

function normalizeHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/detect-new-competitors.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runDetectNewCompetitors() {
    logger.log("Starting detect-new-competitors");

    // patch-28 — discovery is product-aware: every onboarded org runs detection per
    // SKU (each product's self-profile drives its own Exa search). The per-org
    // interval gate still bounds spend; productProfile is no longer required since the
    // per-product self-profiles carry the search inputs.
    const orgs = await db.query.organizations.findMany({
      where: eq(organizations.onboardingCompleted, true),
    });

    logger.log("Orgs to process", { count: orgs.length });

    let totalDetected = 0;
    let totalNotified = 0;

    for (const org of orgs) {
      const cfg = resolveDetectionConfig(org.detectionConfig);
      if (!cfg.autoDetect) continue;
      // Shared with the API, which derives the "next automatic scan" date the
      // Discovery page states from the same intervals.
      const minIntervalMs = DETECTION_MIN_INTERVAL_MS[cfg.cadence];
      if (
        org.detectionLastRunAt &&
        Date.now() - org.detectionLastRunAt.getTime() < minIntervalMs
      ) {
        continue;
      }

      try {
        await db
          .update(organizations)
          .set({ detectionLastRunAt: new Date() })
          .where(eq(organizations.id, org.id));

        // Org's products (active SKUs) with their monitoring anchor (self-competitor).
        const productRows = await db
          .select({
            productId: products.id,
            isPrimary: products.isPrimary,
            selfProfile: competitors.selfProfile,
            url: competitors.url,
          })
          .from(products)
          .innerJoin(competitors, eq(competitors.id, products.selfCompetitorId))
          .where(and(eq(products.orgId, org.id), ne(products.status, "archived")))
          .orderBy(desc(products.isPrimary), asc(products.position));
        if (productRows.length === 0) continue;

        // Dedup against every competitor already tracked in the org (org-wide), loaded
        // once. Candidate dedup is per-product (below) so one company can surface for
        // more than one SKU.
        const existing = await db.query.competitors.findMany({
          where: and(eq(competitors.orgId, org.id), isNull(competitors.deletedAt)),
        });
        const existingHosts = new Set<string>();
        for (const cmp of existing) {
          const h = normalizeHostname(cmp.url);
          if (h) existingHosts.add(h);
        }
        const excludedHosts = new Set(cfg.excludedDomains);

        for (const product of productRows) {
          const profile = selfProfileToDiscoveryProfile(
            product.selfProfile,
            product.isPrimary ? org.productProfile : null,
          );
          if (!profile) continue;
          const productUrl =
            product.url ?? (product.isPrimary ? org.productUrl : null);

          const seenCandidates = await db.query.competitorCandidates.findMany({
            where: and(
              eq(competitorCandidates.orgId, org.id),
              eq(competitorCandidates.productId, product.productId),
            ),
          });
          const seenUrls = new Set(seenCandidates.map((cand) => cand.url));
          const seenHosts = new Set<string>();
          for (const cand of seenCandidates) {
            const h = normalizeHostname(cand.url);
            if (h) seenHosts.add(h);
          }

          // Third recall source alongside Exa's two reads — see nameKnownCompetitors.
          // Best-effort: a miss just narrows the pool.
          const namedSeeds = await nameKnownCompetitors(profile, productUrl).catch(() => []);

          const discovered = await findSimilarCompanies(
            productUrl,
            buildDiscoveryQuery(profile, cfg.keywords),
            CANDIDATES_PER_PRODUCT,
            cfg.excludedDomains,
            cfg.region,
            namedSeeds,
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

          if (fresh.length === 0) {
            logger.log("No fresh candidates for product", {
              orgId: org.id,
              productId: product.productId,
            });
            continue;
          }

          const scored = await scoreOverlap(profile, fresh);
          const scoredByUrl = new Map(scored.map((s) => [s.url, s]));

          // Anti-hallucination (patch-24): one call-level quality envelope per scoring
          // run. Best-effort.
          await insertAiQualityCheck({
            aiTask: "score_overlap",
            targetType: "overlap_scoring",
            orgId: org.id,
            quality: scored._quality,
          });

          const detectedTitles: string[] = [];
          for (const d of fresh) {
            const scoring = scoredByUrl.get(d.url);
            if (!scoring) continue;
            if (scoring.overlapScore <= cfg.minOverlap) continue;

            await db.insert(competitorCandidates).values({
              orgId: org.id,
              productId: product.productId,
              url: d.url,
              title: d.title,
              // The company's own words, straight from the Exa hit: the review
              // queue shows it as the candidate's description.
              snippet: d.snippet || null,
              overlapScore: scoring.overlapScore,
              reason: scoring.reason,
              status: "new",
            });
            detectedTitles.push(d.title);
            totalDetected++;
          }

          if (detectedTitles.length > 0) {
            await db.insert(notifications).values({
              orgId: org.id,
              type: "new_competitor",
              title: buildDetectionTitle(detectedTitles.length),
              body: buildDetectionBody(detectedTitles),
              linkUrl: `/dashboard/discovery?product=${product.productId}`,
            });
            totalNotified++;
          }
        }
      } catch (err) {
        logger.error("detect-new-competitors failed for org", {
          orgId: org.id,
          err: String(err),
        });
      }
    }

    logger.log("Completed detect-new-competitors", {
      orgs: orgs.length,
      detected: totalDetected,
      notified: totalNotified,
    });

    return { orgs: orgs.length, detected: totalDetected, notified: totalNotified };
}
