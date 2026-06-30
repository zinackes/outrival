import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  competitors,
  organizations,
  aiVisibilityPrompts,
  monitors,
  snapshots,
  changes,
} from "@outrival/db";
import { computeHash, uploadToR2 } from "@outrival/shared";
import { extractAiVisibility, AI_CONFIG, type Classification } from "@outrival/ai";
import { queryEngine, type Engine } from "../lib/ai-visibility/engines";
import {
  insertAiVisibilityResults,
  getPreviousAiVisibilityRun,
  loggedAi,
  type AiVisibilityResultRow,
} from "../lib/analytics";
import { aggregate, computeDeltas, type VisibilityDelta } from "../lib/ai-visibility/diff";

// AI Visibility / "Share of Model" — phases 2+3 (docs/ai-visibility.md). For one org:
// query each engine once per tracked prompt, parse which roster subjects (self +
// competitors) the answer mentions, append the verdicts to ai_visibility_results, then
// diff against the previous run and emit signals on meaningful shifts (self drops out /
// a competitor overtakes you / a competitor newly appears). No UI yet (phase 4); one
// engine (Perplexity, phase 5 adds more). Independent of the scrape-monitor pipeline.

const InputSchema = z.object({ orgId: z.string() });

const ENGINES: Engine[] = ["perplexity"]; // OpenAI + Google AIO land in phase 5

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Seed a small starter prompt set from the self product when the org has none, so a
// run is testable before the (phase 4) enable UI exists. Idempotent: only seeds when
// the org has zero prompts. Mirrors what the enable flow will later do.
function defaultPrompts(selfName: string | null, category: string | null): string[] {
  const out: string[] = [];
  if (category) {
    out.push(`best ${category} tools`, `top ${category} software`, `${category} software comparison`);
  }
  if (selfName) out.push(`best alternatives to ${selfName}`, `tools like ${selfName}`);
  return [...new Set(out)].slice(0, 5);
}

export const scrapeAiVisibilityJob = task({
  id: "scrape-ai-visibility",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const { orgId } = InputSchema.parse(payload);

    // Kill-switch: explicit "false" disables; missing key disables (no cost incurred).
    if (process.env.AI_VISIBILITY_ENABLED === "false") {
      logger.log("ai-visibility disabled by kill-switch, skipping", { orgId });
      return { skipped: true, reason: "disabled" };
    }
    const maxPrompts = Number(process.env.AI_VISIBILITY_MAX_PROMPTS ?? 10);

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) throw new AbortTaskRunError(`Org ${orgId} not found`);
    logger.log("Starting scrape-ai-visibility", { orgId, plan: org.plan });

    // Roster = the org's self product + tracked competitors (non-deleted). Subjects the
    // answers are parsed against; the self competitor also seeds default prompts.
    const roster = await db.query.competitors.findMany({
      where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
      columns: { id: true, name: true, type: true, category: true, url: true },
    });
    if (roster.length === 0) {
      logger.log("No competitors in roster, skipping", { orgId });
      return { skipped: true, reason: "empty_roster" };
    }
    const self = roster.find((c) => c.type === "self") ?? null;

    // Prompts: active set, or a seeded starter set if the org has none yet.
    let prompts = await db.query.aiVisibilityPrompts.findMany({
      where: and(eq(aiVisibilityPrompts.orgId, orgId), eq(aiVisibilityPrompts.isActive, true)),
    });
    if (prompts.length === 0) {
      const seeds = defaultPrompts(self?.name ?? null, self?.category ?? null);
      if (seeds.length === 0) {
        logger.log("No prompts and nothing to seed (no self product), skipping", { orgId });
        return { skipped: true, reason: "no_prompts" };
      }
      await db.insert(aiVisibilityPrompts).values(
        seeds.map((p) => ({ orgId, prompt: p, origin: "auto" })),
      );
      prompts = await db.query.aiVisibilityPrompts.findMany({
        where: and(eq(aiVisibilityPrompts.orgId, orgId), eq(aiVisibilityPrompts.isActive, true)),
      });
      logger.log("Seeded default prompts", { orgId, count: seeds.length });
    }
    prompts = prompts.slice(0, maxPrompts);

    const subjectNames = roster.map((c) => c.name);
    const runId = crypto.randomUUID();
    const now = new Date();
    const allRows: AiVisibilityResultRow[] = [];
    let queries = 0;

    for (const prompt of prompts) {
      for (const engine of ENGINES) {
        const res = await queryEngine(engine, prompt.prompt);
        if (!res) continue; // missing key / API error — best-effort, skip
        queries++;

        const extraction = await loggedAi("extract_ai_visibility", AI_CONFIG.classification, () =>
          extractAiVisibility(res.answer, subjectNames),
        );
        if (!extraction) continue;

        // Index the model's verdicts by normalized subject name (identity is trusted
        // from the ROSTER, never the model — unmatched names are ignored).
        const verdict = new Map(extraction.mentions.map((m) => [norm(m.name), m]));
        const excerpt = res.answer.slice(0, 2000);

        // One row per roster subject, mentioned or not, so share-of-voice is derivable.
        const rows: AiVisibilityResultRow[] = roster.map((c) => {
          const v = verdict.get(norm(c.name));
          return {
            org_id: orgId,
            prompt_id: prompt.id,
            competitor_id: c.id,
            engine,
            mentioned: v?.mentioned ?? false,
            rank: v?.mentioned ? v.rank : null,
            cited: v?.mentioned ? v.cited : null,
            sentiment_score: v?.mentioned ? v.sentiment : null,
            answer_excerpt: excerpt,
            run_id: runId,
            recorded_at: now,
          };
        });
        await insertAiVisibilityResults(rows);
        allRows.push(...rows);
      }
    }

    // Phase 3: diff against the previous run and signal on meaningful shifts only.
    let signalled = 0;
    if (allRows.length > 0) {
      const prevRows = await getPreviousAiVisibilityRun(orgId, runId);
      if (prevRows && prevRows.length > 0) {
        const currAgg = aggregate(
          allRows.map((r) => ({
            competitorId: r.competitor_id,
            engine: r.engine,
            promptId: r.prompt_id,
            mentioned: r.mentioned,
            rank: r.rank ?? null,
          })),
        );
        const deltas = computeDeltas(aggregate(prevRows), currAgg, self?.id ?? null);
        if (deltas.length > 0) {
          const nameById = new Map(roster.map((c) => [c.id, c.name]));
          const urlById = new Map(roster.map((c) => [c.id, c.url ?? null]));
          signalled = await emitVisibilitySignals(deltas, nameById, urlById);
        }
      }
    }

    logger.log("Completed scrape-ai-visibility", {
      orgId,
      prompts: prompts.length,
      queries,
      rowsWritten: allRows.length,
      signalled,
    });
    return { prompts: prompts.length, queries, rowsWritten: allRows.length, signalled, runId };
  },
});

const ENGINE_LABEL: Record<string, string> = { perplexity: "Perplexity" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

function deltaCopy(d: VisibilityDelta, name: string): { diffText: string; reason: string } {
  const engine = ENGINE_LABEL[d.engine] ?? d.engine;
  switch (d.type) {
    case "self_dropped":
      return {
        diffText: `Your product is no longer mentioned in ${engine} AI answers for any tracked prompt (it appeared in ${pct(d.subjectBefore)} of prompts last run).`,
        reason: `Your product dropped out of ${engine} AI answers`,
      };
    case "overtaken":
      return {
        diffText: `${name} now appears in ${pct(d.subjectAfter)} of ${engine} AI answers vs your ${pct(d.selfAfter)} — overtaking your product since the last run (previously ${pct(d.subjectBefore)} vs your ${pct(d.selfBefore)}).`,
        reason: `${name} overtook your product in ${engine} AI answers`,
      };
    case "competitor_appeared":
      return {
        diffText: `${name} started appearing in ${engine} AI answers (${pct(d.subjectAfter)} of tracked prompts), where it was absent last run.`,
        reason: `${name} newly appeared in ${engine} AI answers`,
      };
  }
}

// Anchor each meaningful shift into the existing signal pipeline. The ai_visibility
// monitor is infra (isActive=false → never scheduled / handled by getScraper); it and
// the snapshot exist only to satisfy the changes FK chain, exactly like tech_stack.
async function emitVisibilitySignals(
  deltas: VisibilityDelta[],
  nameById: Map<string, string>,
  urlById: Map<string, string | null>,
): Promise<number> {
  let emitted = 0;
  for (const d of deltas) {
    const name = nameById.get(d.competitorId) ?? "A competitor";
    const { diffText, reason } = deltaCopy(d, name);

    let monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.competitorId, d.competitorId),
        eq(monitors.sourceType, "ai_visibility"),
      ),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId: d.competitorId,
          sourceType: "ai_visibility",
          frequency: "weekly", // unused — this monitor is never scheduled
          isActive: false,
          config: {},
        })
        .returning();
    }
    if (!monitor) continue;

    const prevSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    // R2 before DB (snapshots.r2Key is NOT NULL). The "snapshot" is the evidence text.
    const timestamp = new Date().toISOString();
    const r2Key = `snapshots/${d.competitorId}/ai_visibility/${timestamp}`;
    await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash: computeHash(`${d.type}:${d.engine}:${d.competitorId}:${diffText}`),
        status: "success",
        scrapedAt: new Date(),
        resolvedUrl: urlById.get(d.competitorId) ?? null,
      })
      .returning();
    if (!snapshot) continue;

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText,
        diffType: "text",
        rawDiff: {
          aiVisibility: {
            type: d.type,
            engine: d.engine,
            subjectAfter: d.subjectAfter,
            selfAfter: d.selfAfter,
          },
        },
        detectedAt: new Date(),
      })
      .returning();
    if (!change) continue;

    const classification: Classification = {
      category: "content",
      severity: d.severity,
      is_significant: true,
      reason,
      humanChangeBefore: pct(d.subjectBefore),
      humanChangeAfter: pct(d.subjectAfter),
    };
    await tasks.trigger("generate-signal", { changeId: change.id, classification });
    emitted++;
  }
  return emitted;
}
