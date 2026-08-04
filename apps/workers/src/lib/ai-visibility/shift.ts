import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, aiVisibilityResults, changes, monitors } from "@outrival/db";
import {
  VISIBILITY_MIN_RUNS,
  VISIBILITY_SHIFT_COOLDOWN_DAYS,
  detectVisibilityShift,
  subjectMetrics,
  visibilityWindows,
  type SubjectMetrics,
  type VisibilityAnswer,
  type VisibilityShift,
} from "@outrival/shared";

/**
 * `ai_visibility_shift` — Positioning Intelligence v2 P5.
 *
 * This replaces the run-to-run diff that shipped with phase 3. That diff compared
 * the last sweep to the one before it, and an answer engine asked the same buyer
 * question twice does not answer it the same way: most of what it fired on was the
 * engine's variance, dressed up as "Acme overtook you this week". A signal that is
 * wrong more often than it is right teaches the reader to ignore the feed.
 *
 * So the unit is a WINDOW. Four weeks of runs against the previous four, both sides
 * required to hold enough runs to average, one signal per subject per four weeks.
 * The self product is a subject like any other — a collapse in YOUR OWN visibility
 * is the single most important thing this feature can tell anyone, and the run-to-run
 * version could only see it as a total drop-out.
 *
 * Nothing here calls a model.
 */

export interface EngineBreakdown {
  engine: string;
  current: SubjectMetrics;
  previous: SubjectMetrics;
}

export interface SubjectShift {
  competitorId: string;
  isSelf: boolean;
  shift: VisibilityShift;
  /** Both windows split per engine, when more than one engine answered. */
  byEngine: EngineBreakdown[];
}

interface Row {
  competitorId: string;
  runId: string;
  promptId: string;
  engine: string;
  recordedAt: Date;
  mentioned: number;
  promptNamed: number;
  rank: number | null;
  cited: number | null;
  sentiment: number | null;
}

const toAnswer = (r: Row): VisibilityAnswer => ({
  competitorId: r.competitorId,
  runId: r.runId,
  promptId: r.promptId,
  engine: r.engine,
  recordedAt: r.recordedAt,
  mentioned: r.mentioned === 1,
  promptNamed: r.promptNamed === 1,
  rank: r.rank,
  cited: r.cited == null ? null : r.cited === 1,
  sentiment: r.sentiment,
});

/**
 * Shifts worth signalling for one product's roster, this window against the last.
 *
 * `rosterIds` is the closed subject set the runs were written against (self first).
 * A subject with no rows in either window simply produces no shift — the gate on
 * run counts already refuses it.
 */
export async function computeVisibilityShifts(args: {
  orgId: string;
  productId: string;
  rosterIds: string[];
  selfId: string | null;
  now: Date;
  minRuns?: number;
}): Promise<SubjectShift[]> {
  const { orgId, productId, rosterIds, selfId, now } = args;
  const minRuns = args.minRuns ?? VISIBILITY_MIN_RUNS;
  if (rosterIds.length === 0) return [];

  const { current, previous } = visibilityWindows(now);

  const rows: Row[] = await db
    .select({
      competitorId: aiVisibilityResults.competitorId,
      runId: aiVisibilityResults.runId,
      promptId: aiVisibilityResults.promptId,
      engine: aiVisibilityResults.engine,
      recordedAt: aiVisibilityResults.recordedAt,
      mentioned: aiVisibilityResults.mentioned,
      promptNamed: aiVisibilityResults.promptNamed,
      rank: aiVisibilityResults.rank,
      cited: aiVisibilityResults.cited,
      sentiment: aiVisibilityResults.sentimentScore,
    })
    .from(aiVisibilityResults)
    .where(
      and(
        eq(aiVisibilityResults.orgId, orgId),
        eq(aiVisibilityResults.productId, productId),
        inArray(aiVisibilityResults.competitorId, rosterIds),
        gte(aiVisibilityResults.recordedAt, previous.start),
        lt(aiVisibilityResults.recordedAt, current.end),
      ),
    );

  const out: SubjectShift[] = [];
  for (const competitorId of rosterIds) {
    const mine = rows.filter((r) => r.competitorId === competitorId).map(toAnswer);
    const inCurrent = mine.filter((r) => r.recordedAt >= current.start);
    const inPrevious = mine.filter((r) => r.recordedAt < current.start);

    const currentMetrics = subjectMetrics(inCurrent);
    const previousMetrics = subjectMetrics(inPrevious);
    const shift = detectVisibilityShift(currentMetrics, previousMetrics, minRuns);
    if (!shift) continue;

    // The per-engine split is evidence, not a second gate: one engine dropping a
    // brand while another keeps it is exactly the detail the fact block should
    // carry, and the headline stays the pooled number the copy quotes.
    const engines = [...new Set(mine.map((r) => r.engine))].sort();
    const byEngine: EngineBreakdown[] =
      engines.length > 1
        ? engines.map((engine) => ({
            engine,
            current: subjectMetrics(inCurrent.filter((r) => r.engine === engine)),
            previous: subjectMetrics(inPrevious.filter((r) => r.engine === engine)),
          }))
        : [];

    out.push({ competitorId, isSelf: competitorId === selfId, shift, byEngine });
  }
  return out;
}

/**
 * The subjects that already signalled inside the cooldown.
 *
 * The cooldown is read off the `ai_visibility` anchor changes themselves rather
 * than a column of its own: the anchor IS the record that a shift was published,
 * and it is written in the same transaction chain as the signal. Its length equals
 * the window, so two consecutive signals can never be computed off overlapping
 * data — a 27-day-old drop would otherwise be re-announced by the same rows.
 */
export async function subjectsInCooldown(
  competitorIds: string[],
  now: Date,
  cooldownDays: number = VISIBILITY_SHIFT_COOLDOWN_DAYS,
): Promise<Set<string>> {
  if (competitorIds.length === 0) return new Set();
  const since = new Date(now.getTime() - cooldownDays * 86_400_000);
  const rows = await db
    .select({ competitorId: monitors.competitorId })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(
      and(
        eq(monitors.sourceType, "ai_visibility"),
        inArray(monitors.competitorId, competitorIds),
        gte(changes.detectedAt, since),
      ),
    )
    .groupBy(monitors.competitorId);
  return new Set(rows.map((r) => r.competitorId));
}

/** The rawDiff a shift writes onto its anchor change — the fact block's source. */
export function shiftRawDiff(s: SubjectShift): Record<string, unknown> {
  const pack = (m: SubjectMetrics) => ({
    mentionRate: m.mentionRate,
    mentions: m.mentions,
    answers: m.answers,
    avgRank: m.avgRank,
    citedRate: m.citedRate,
    avgSentiment: m.avgSentiment,
    nRuns: m.nRuns,
    engines: m.engines,
  });
  return {
    kind: "ai_visibility_shift",
    driver: s.shift.driver,
    direction: s.shift.direction,
    isSelf: s.isSelf,
    current: pack(s.shift.current),
    previous: pack(s.shift.previous),
    byEngine: s.byEngine.map((e) => ({
      engine: e.engine,
      current: pack(e.current),
      previous: pack(e.previous),
    })),
  };
}
