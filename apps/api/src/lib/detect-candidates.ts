import { and, eq, isNull } from "drizzle-orm";
import {
  competitors,
  competitorCandidates,
  notifications,
  organizations,
} from "@outrival/db";
import { findSimilarCompanies } from "@outrival/scrapers/discovery";
import { scoreOverlap } from "@outrival/ai";
import { normalizeHostname } from "@outrival/shared";
import { db } from "./db";

const MIN_OVERLAP = 65;
const CANDIDATES_PER_ORG = 20;

export type DetectResult =
  | { ok: true; detected: number }
  | { ok: false; error: "missing_profile" };

export async function detectCandidatesForOrg(orgId: string): Promise<DetectResult> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org || !org.productUrl || !org.productProfile) {
    return { ok: false, error: "missing_profile" };
  }

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

  const discovered = await findSimilarCompanies(org.productUrl, CANDIDATES_PER_ORG);
  const fresh = discovered.filter((d) => {
    if (seenUrls.has(d.url)) return false;
    const host = normalizeHostname(d.url);
    if (!host) return false;
    if (existingHosts.has(host)) return false;
    if (seenHosts.has(host)) return false;
    return true;
  });

  if (fresh.length === 0) return { ok: true, detected: 0 };

  const scored = await scoreOverlap(org.productProfile, fresh);
  const scoredByUrl = new Map(scored.map((s) => [s.url, s]));

  let detected = 0;
  for (const d of fresh) {
    const scoring = scoredByUrl.get(d.url);
    if (!scoring) continue;
    if (scoring.overlapScore <= MIN_OVERLAP) continue;

    await db.insert(competitorCandidates).values({
      orgId,
      url: d.url,
      title: d.title,
      overlapScore: scoring.overlapScore,
      reason: scoring.reason,
      status: "new",
    });

    await db.insert(notifications).values({
      orgId,
      type: "new_competitor",
      title: `Nouveau concurrent détecté : ${d.title}`,
      body: `Overlap ${Math.round(scoring.overlapScore)}% — ${scoring.reason}`,
      linkUrl: `/dashboard/candidates`,
    });

    detected++;
  }

  return { ok: true, detected };
}
