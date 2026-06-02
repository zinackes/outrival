import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
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
import { insertTechStackHistory } from "../lib/clickhouse";

// Independent of the homepage pipeline (patch-18): native fetch + cheerio only,
// no crawlee/playwright. Lazy subpath import keeps the (light) module out of the
// task parse path along with the rest.
type DetectedTech = import("@outrival/scrapers/tech-stack").DetectedTech;

const InputSchema = z.object({ competitorId: z.string() });

const IMPORTANCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function importanceRank(level: string): number {
  return IMPORTANCE_RANK[level] ?? 0;
}

// A tech appearance important enough to spend an AI signal on maps to a severity:
// a high-importance tell (Stripe, Salesforce) → high (alertable); medium → medium.
function severityForImportance(importance: string): Classification["severity"] {
  return importance === "high" ? "high" : "medium";
}

export const scrapeTechStackJob = task({
  id: "scrape-tech-stack",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
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

    const { fetchTechStackEvidence, detectTechStack } = await import(
      "@outrival/scrapers/tech-stack"
    );

    // Primary source: the homepage. A null result means a blocked/failed fetch —
    // do NOT run the diff (an empty detection would false-flag every current tech
    // as "disappeared"). Just record the attempt and bail.
    const home = await fetchTechStackEvidence(competitor.url);
    if (!home) {
      logger.warn("Tech-stack fetch returned no evidence (blocked/failed), skipping diff", {
        competitorId,
        url: competitor.url,
      });
      await db
        .update(competitors)
        .set({ techStackScrapedAt: new Date() })
        .where(eq(competitors.id, competitor.id));
      return { skipped: true, reason: "no_evidence" };
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

    // Signal only for important appearances (>= TECH_STACK_SIGNAL_MIN_IMPORTANCE).
    // Disappearances never signal (per spec). Each important new tech becomes one
    // signal via the existing pipeline (synthetic monitor → snapshot → change →
    // generate-signal), so signals.changeId's NOT-NULL FK is satisfied.
    const minImportance = process.env.TECH_STACK_SIGNAL_MIN_IMPORTANCE ?? "medium";
    const important = appeared.filter(
      (t) => importanceRank(t.importance) >= importanceRank(minImportance),
    );

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
  },
});

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
      `New technology detected on ${competitorName}: ${tech.name} (${tech.category}). ` +
      `Evidence: ${tech.evidence.join(", ")}.`;

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
      reason: `${tech.name} (${tech.category}) newly detected in the competitor's stack`,
      humanChangeBefore: null,
      humanChangeAfter: tech.name,
    };

    await tasks.trigger("generate-signal", { changeId: change.id, classification });
  }
}
