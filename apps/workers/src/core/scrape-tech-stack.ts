import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  changes,
  techStackEntries,
} from "@outrival/db";
import { computeHash, uploadToR2 } from "@outrival/shared";
import type { Classification } from "@outrival/ai";
import { insertTechStackHistory } from "../lib/analytics";
import { severityForImportance, signalEligibleTechs } from "../lib/tech-stack-signal";

// Independent of the homepage pipeline (patch-18): native fetch + cheerio only,
// no crawlee/playwright. Lazy subpath import keeps the (light) module out of the
// task parse path along with the rest.
type DetectedTech = import("@outrival/scrapers/tech-stack").DetectedTech;

const InputSchema = z.object({ competitorId: z.string() });

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/scrape-tech-stack.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out call change.
export async function runScrapeTechStack(payload: z.input<typeof InputSchema>) {
    const { competitorId } = InputSchema.parse(payload);
    logger.log("Starting scrape-tech-stack", { competitorId });

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
    if (!competitor.url || competitor.deletedAt) {
      logger.log("Competitor has no live URL or is deleted, skipping", { competitorId });
      return { skipped: true };
    }
    // Read BEFORE this run stamps techStackScrapedAt below — a null here means
    // this is the first-ever tech-stack scan of this competitor, so every
    // "appeared" tech is baseline noise, not news.
    const isBaselineScan = competitor.techStackScrapedAt == null;

    const { fetchTechStackEvidence, detectTechStack } = await import(
      "@outrival/scrapers/tech-stack"
    );
    const { isCloudflareChallenge } = await import("@outrival/scrapers/block-detection");

    // Primary source: the homepage. A null result means a blocked/failed fetch —
    // do NOT run the diff (an empty detection would false-flag every current tech
    // as "disappeared"). A 200 anti-bot challenge shell is the same trap: it has
    // HTML (non-null) but no real tech, so guard it the same way. Record the
    // attempt and bail in both cases.
    const home = await fetchTechStackEvidence(competitor.url);
    if (!home || isCloudflareChallenge(home.html)) {
      logger.warn("Tech-stack fetch blocked/empty (no evidence or challenge shell), skipping diff", {
        competitorId,
        url: competitor.url,
        reason: home ? "challenge" : "no_evidence",
      });
      await db
        .update(competitors)
        .set({ techStackScrapedAt: new Date() })
        .where(eq(competitors.id, competitor.id));
      return { skipped: true, reason: home ? "challenge" : "no_evidence" };
    }

    // Merge detections from the homepage and, if present, the /integrations page
    // (deduped by techId; an integrations-only tech is tagged accordingly). The
    // absence of /integrations is silent, never an error.
    const byTechId = new Map<string, DetectedTech>();
    for (const d of detectTechStack(home)) byTechId.set(d.techId, d);

    let integrationsUrl: string | null = null;
    try {
      integrationsUrl = new URL("/integrations", competitor.url).toString();
    } catch {
      integrationsUrl = null;
    }
    if (integrationsUrl) {
      const integrations = await fetchTechStackEvidence(integrationsUrl);
      if (integrations) {
        for (const d of detectTechStack(integrations)) {
          const existing = byTechId.get(d.techId);
          if (existing) {
            existing.evidence = [...new Set([...existing.evidence, ...d.evidence])];
          } else {
            byTechId.set(d.techId, { ...d, evidence: [...d.evidence, "source:integrations_page"] });
          }
        }
      }
    }

    const detected = [...byTechId.values()];
    const detectedIds = new Set(detected.map((d) => d.techId));

    // Reconcile against the present state. A tech is "appeared" when no ACTIVE
    // row currently exists for it (brand-new OR a reactivation of a dormant row).
    const current = await db.query.techStackEntries.findMany({
      where: and(
        eq(techStackEntries.competitorId, competitor.id),
        eq(techStackEntries.isActive, true),
      ),
    });
    const activeIds = new Set(current.map((c) => c.techId));

    const appeared = detected.filter((d) => !activeIds.has(d.techId));
    const disappeared = current.filter((c) => !detectedIds.has(c.techId));

    // Upsert every detected tech: a dormant (isActive=false) row is reactivated in
    // place (firstDetectedAt preserved) so the history stays intact.
    for (const tech of detected) {
      await db
        .insert(techStackEntries)
        .values({
          competitorId: competitor.id,
          techId: tech.techId,
          techName: tech.name,
          category: tech.category,
          importance: tech.importance,
          evidence: tech.evidence,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [techStackEntries.competitorId, techStackEntries.techId],
          set: {
            techName: tech.name,
            category: tech.category,
            importance: tech.importance,
            evidence: tech.evidence,
            lastDetectedAt: new Date(),
            isActive: true,
          },
        });
    }

    if (disappeared.length > 0) {
      await db
        .update(techStackEntries)
        .set({ isActive: false })
        .where(
          and(
            eq(techStackEntries.competitorId, competitor.id),
            inArray(
              techStackEntries.techId,
              disappeared.map((d) => d.techId),
            ),
          ),
        );
    }

    const now = new Date();
    await insertTechStackHistory([
      ...appeared.map((t) => ({
        competitor_id: competitor.id,
        tech_id: t.techId,
        event: "appeared" as const,
        importance: t.importance,
        recorded_at: now,
      })),
      ...disappeared.map((t) => ({
        competitor_id: competitor.id,
        tech_id: t.techId,
        event: "disappeared" as const,
        importance: t.importance,
        recorded_at: now,
      })),
    ]);

    await db
      .update(competitors)
      .set({ techStackScrapedAt: now })
      .where(eq(competitors.id, competitor.id));

    // Signal only for important appearances (>= TECH_STACK_SIGNAL_MIN_IMPORTANCE),
    // and NEVER on the baseline scan (first-ever run: everything "appears", none of
    // it is news — audit 2026-07-09 found this was 28% of the entire signal feed).
    // Disappearances never signal (per spec). Each important new tech becomes one
    // signal via the existing pipeline (synthetic monitor → snapshot → change →
    // generate-signal), so signals.changeId's NOT-NULL FK is satisfied.
    const minImportance = process.env.TECH_STACK_SIGNAL_MIN_IMPORTANCE ?? "high";
    const important = signalEligibleTechs(appeared, { isBaselineScan, minImportance });

    if (isBaselineScan && appeared.length > 0) {
      logger.log("Baseline tech-stack scan — recording entries, no signals", {
        competitorId,
        appeared: appeared.length,
      });
    }

    if (important.length > 0) {
      await emitTechStackSignals(competitor.id, competitor.name, competitor.url, home.html, important);
    }

    logger.log("Completed scrape-tech-stack", {
      competitorId,
      detected: detected.length,
      appeared: appeared.length,
      disappeared: disappeared.length,
      signalled: important.length,
    });

    return {
      detected: detected.length,
      appeared: appeared.length,
      disappeared: disappeared.length,
      signalled: important.length,
    };
}

// Anchor an important appearance into the signal pipeline. The tech_stack monitor
// is infra (isActive=false → never enqueued by schedule-scraping nor handled by
// getScraper); it and the snapshot exist only to satisfy the changes FK chain.
async function emitTechStackSignals(
  competitorId: string,
  competitorName: string,
  competitorUrl: string,
  html: string,
  techs: DetectedTech[],
): Promise<void> {
  // Lazily ensure the per-competitor anchor monitor.
  let monitor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitorId),
      eq(monitors.sourceType, "tech_stack"),
    ),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId,
        sourceType: "tech_stack",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: { url: competitorUrl },
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure tech_stack monitor");

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  // One snapshot shared by this run's signals. R2 before DB (snapshots.r2Key is
  // NOT NULL). contentHash = stable hash of the detected set.
  const timestamp = new Date().toISOString();
  const r2Key = `snapshots/${competitorId}/tech_stack/${timestamp}`;
  await uploadToR2(`${r2Key}.html`, html, "text/html; charset=utf-8", { compress: true });

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      monitorId: monitor.id,
      r2Key,
      contentHash: computeHash(techs.map((t) => t.techId).sort().join(",")),
      status: "success",
      scrapedAt: new Date(),
      resolvedUrl: competitorUrl,
    })
    .returning();
  if (!snapshot) throw new Error("Failed to insert tech_stack snapshot");

  for (const tech of techs) {
    const diffText =
      `Technology newly detected on ${competitorName} since the previous tech-stack scan: ` +
      `${tech.name} (${tech.category}). Evidence: ${tech.evidence.join(", ")}. ` +
      `Note: detection reflects what the site exposes to visitors — it can lag or lead the actual adoption date.`;

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText,
        diffType: "text",
        rawDiff: { added: [tech.name], removed: [] },
        detectedAt: new Date(),
      })
      .returning();
    if (!change) continue;

    const classification: Classification = {
      category: "product",
      severity: severityForImportance(tech.importance),
      is_significant: true,
      reason: `${tech.name} (${tech.category}) newly detected since the previous tech-stack scan`,
      humanChangeBefore: null,
      humanChangeAfter: tech.name,
    };

    await generateSignal.enqueue({ changeId: change.id, classification });
  }
}
