import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  db,
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
  resolveDetectionConfig,
} from "@outrival/shared";

const CANDIDATES_PER_ORG = 20;
const WEEKLY_MIN_MS = 6 * 24 * 60 * 60 * 1000;
const MONTHLY_MIN_MS = 27 * 24 * 60 * 60 * 1000;

function normalizeHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

export const detectNewCompetitorsJob = schedules.task({
  id: "detect-new-competitors",
  cron: "0 20 * * 0",
  maxDuration: 600,

  async run() {
    logger.log("Starting detect-new-competitors");

    const orgs = await db.query.organizations.findMany({
      where: and(
        isNotNull(organizations.productProfile),
        eq(organizations.onboardingCompleted, true),
      ),
    });

    logger.log("Orgs to process", { count: orgs.length });

    let totalDetected = 0;
    let totalNotified = 0;

    for (const org of orgs) {
      if (!org.productProfile) continue;

      const cfg = resolveDetectionConfig(org.detectionConfig);
      if (!cfg.autoDetect) continue;
      const minIntervalMs =
        cfg.cadence === "monthly" ? MONTHLY_MIN_MS : WEEKLY_MIN_MS;
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

        const existing = await db.query.competitors.findMany({
          where: and(eq(competitors.orgId, org.id), isNull(competitors.deletedAt)),
        });
        const existingHosts = new Set<string>();
        for (const c of existing) {
          const h = normalizeHostname(c.url);
          if (h) existingHosts.add(h);
        }

        const seenCandidates = await db.query.competitorCandidates.findMany({
          where: eq(competitorCandidates.orgId, org.id),
        });
        const seenUrls = new Set(seenCandidates.map((c) => c.url));
        const seenHosts = new Set<string>();
        for (const c of seenCandidates) {
          const h = normalizeHostname(c.url);
          if (h) seenHosts.add(h);
        }
        const excludedHosts = new Set(cfg.excludedDomains);

        const discovered = await findSimilarCompanies(
          org.productUrl,
          buildDiscoveryQuery(org.productProfile, cfg.keywords),
          CANDIDATES_PER_ORG,
          cfg.excludedDomains,
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
          logger.log("No fresh candidates for org", { orgId: org.id });
          continue;
        }

        const scored = await scoreOverlap(org.productProfile, fresh);
        const scoredByUrl = new Map(scored.map((s) => [s.url, s]));

        // Anti-hallucination (patch-24): one call-level quality envelope per weekly
        // scoring run. Best-effort.
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
            url: d.url,
            title: d.title,
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
            linkUrl: `/dashboard/candidates`,
          });
          totalNotified++;
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
  },
});
