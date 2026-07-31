import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, competitors, monitors, snapshots, changes, jobPostings } from "@outrival/db";
import { computeHash, uploadToR2, DEPARTMENT_BUCKET_LABELS } from "@outrival/shared";
import {
  detectSalaryBandShift,
  disclosureVerdict,
  isoWeekStart,
  type DepartmentBucket,
  type SalaryBandSeries,
  type FiringBand,
} from "@outrival/scrapers/jobs-hiring";
import { getHiringSalaryBandSeries, getHiringMetricsHistory } from "../lib/analytics";

// Salary signals (Hiring Intelligence v2 P3). Triggered off extract-jobs per
// competitor, after an authoritative ATS scrape has upserted the week's
// hiring_salary_bands — not a cron, and not inline in extract-jobs, whose ordering
// is retry-safety-critical (the same reasoning as detect-hiring-footprint).
//
// Two deterministic signals, no AI anywhere in the decision:
//   salary_band_shift           a (bucket, currency) p50 moving ±15% vs its own
//                               trailing weeks — same currency only, always
//   salary_disclosure_started   a board that published no pay and now does
//
// Both are MEDIUM at most. A pay band is read off a page and is a lagging,
// aggregate quantity: it does not deserve the channel that bypasses moderation and
// emails someone within minutes.

const InputSchema = z.object({ competitorId: z.string() });

/** Trailing ISO weeks read (needs 4 baseline + current, plus slack for gaps). */
const SERIES_WEEKS = 16;
/** Cap per run. Held-back bands fire next run; nothing is lost, only deferred. */
const MAX_BANDS_PER_RUN = 2;

const SHIFT_THRESHOLD = Number(process.env.SALARY_BAND_SHIFT_THRESHOLD ?? 0.15);
const SHIFT_MIN_N = Number(process.env.SALARY_BAND_MIN_POSTINGS ?? 3);
/**
 * Weeks a (bucket, currency) stays quiet after firing. A band that steps up and
 * holds is ONE piece of news: without this, the new level becomes the baseline
 * gradually and the same move re-fires as it works through the trailing window.
 */
const SHIFT_COOLDOWN_WEEKS = Number(process.env.SALARY_BAND_COOLDOWN_WEEKS ?? 4);
/**
 * Weeks of prior board history (with a real board behind them) before "they have
 * STARTED publishing salaries" is a claim about them rather than about when we
 * started looking.
 */
const DISCLOSURE_MIN_WEEKS = 4;
/** Below this many open roles a week, a board publishing nothing says nothing. */
const DISCLOSURE_MIN_BOARD = 5;

export async function runDetectSalaryShifts(payload: z.input<typeof InputSchema>) {
  const { competitorId } = InputSchema.parse(payload);
  logger.log("Starting detect-salary-shifts", { competitorId });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };
  // What our own product pays is not competitive intelligence.
  if (competitor.type === "self") return { skipped: true, reason: "self" };

  const now = new Date();
  const currentWeek = isoWeekStart(now);
  const emitted: string[] = [];

  // ── salary_band_shift ─────────────────────────────────────────────────────
  const rows = await getHiringSalaryBandSeries(competitorId, SERIES_WEEKS);
  const byKey = new Map<string, SalaryBandSeries>();
  for (const r of rows) {
    const key = `${r.department_bucket}|${r.currency}`;
    const series = byKey.get(key) ?? {
      bucket: r.department_bucket as DepartmentBucket,
      currency: r.currency,
      points: [],
    };
    series.points.push({ weekStart: r.week_start, p50: r.p50, n: r.n });
    byKey.set(key, series);
  }

  const firing = detectSalaryBandShift([...byKey.values()], currentWeek, {
    threshold: SHIFT_THRESHOLD,
    minN: SHIFT_MIN_N,
  });
  if (firing.length > MAX_BANDS_PER_RUN) {
    logger.log("Holding back salary-band signals past the per-run cap", {
      competitorId,
      held: firing.slice(MAX_BANDS_PER_RUN).map((f) => `${f.bucket}:${f.currency}`),
    });
  }
  for (const band of firing.slice(0, MAX_BANDS_PER_RUN)) {
    if (await inCooldown(competitorId, band.bucket, band.currency, now)) {
      logger.log("Salary band still in cooldown — skipping", {
        competitorId,
        bucket: band.bucket,
        currency: band.currency,
      });
      continue;
    }
    const changeId = await emitBandShift(competitorId, competitor.name, band, competitor.url);
    if (changeId) emitted.push(`band:${band.bucket}:${band.currency}`);
  }

  // ── salary_disclosure_started ─────────────────────────────────────────────
  const disclosureId = await evaluateDisclosure(competitorId, competitor.name, competitor.url);
  if (disclosureId) emitted.push("disclosure");

  logger.log("Completed detect-salary-shifts", { competitorId, emitted });
  return { emitted };
}

/**
 * Has this (bucket, currency) already been signalled inside the cooldown? Read off
 * the anchor's own changes, so the window survives a worker restart and a re-scan.
 */
async function inCooldown(
  competitorId: string,
  bucket: string,
  currency: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - SHIFT_COOLDOWN_WEEKS * 7 * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(
      and(
        eq(monitors.competitorId, competitorId),
        eq(monitors.sourceType, "hiring_salary"),
        gte(changes.detectedAt, since),
        sql`${changes.rawDiff}->>'kind' = 'salary_band_shift'`,
        sql`${changes.rawDiff}->>'bucket' = ${bucket}`,
        sql`${changes.rawDiff}->>'currency' = ${currency}`,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/** The roles the band was computed over, so the signal can name them. */
async function rolesInBand(competitorId: string, currency: string, limit: number) {
  return db
    .select({
      title: jobPostings.title,
      url: jobPostings.url,
      location: jobPostings.location,
      salaryMin: jobPostings.salaryMin,
      salaryMax: jobPostings.salaryMax,
    })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        eq(jobPostings.isActive, true),
        eq(jobPostings.salaryCurrency, currency),
      ),
    )
    .orderBy(desc(jobPostings.detectedAt))
    .limit(limit);
}

async function emitBandShift(
  competitorId: string,
  name: string,
  band: FiringBand,
  competitorUrl: string | null,
): Promise<string | null> {
  const label = DEPARTMENT_BUCKET_LABELS[band.bucket] ?? band.bucket;
  const direction = band.delta > 0 ? "up" : "down";
  const pct = Math.abs(Math.round(band.delta * 100));
  const before = money(Math.round(band.baseline), band.currency);
  const after = money(band.current.p50, band.currency);

  const roles = await rolesInBand(competitorId, band.currency, 5);
  const roleLines = roles.map(
    (r) =>
      `- ${r.title}${r.location ? ` (${r.location})` : ""}` +
      `${r.salaryMin != null || r.salaryMax != null ? ` — ${range(r.salaryMin, r.salaryMax, band.currency)}` : ""}` +
      `${r.url ? ` — ${r.url}` : ""}`,
  );

  const trailingLine = band.trailing
    .map((p) => `${p.weekStart}: ${money(p.p50, band.currency)} (n=${p.n})`)
    .join(", ");

  const diffText =
    `${name} has moved its ${label.toLowerCase()} pay ${direction} in ${band.currency}: ` +
    `median ${before} → ${after} (${pct}%), across ${band.current.n} open roles.\n\n` +
    `${roleLines.join("\n")}\n\n` +
    `Trailing weeks — ${trailingLine}.\n\n` +
    `The figure is the median of the annualised midpoints of the salary ranges ` +
    `${name} publishes on its own job board, computed only over roles quoted in ` +
    `${band.currency}: nothing is converted between currencies, and hourly rates ` +
    `are excluded, so the comparison is like for like. What a competitor pays for a ` +
    `function is what they believe that function is worth to them, and it moves ` +
    `before any hiring-plan announcement does.`;

  const changeId = await writeAnchoredChange(
    competitorId,
    `band:${band.bucket}:${band.currency}:${band.current.weekStart}`,
    diffText,
    {
      kind: "salary_band_shift",
      bucket: band.bucket,
      currency: band.currency,
      p50Before: Math.round(band.baseline),
      p50After: band.current.p50,
      n: band.current.n,
      delta: band.delta,
      trailing: band.trailing,
    },
    competitorUrl,
  );
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "hiring" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${name} moved its ${label.toLowerCase()} median pay ${direction} ${pct}% in ${band.currency}`,
      humanChangeBefore: `${label} (${band.currency}) — p50 ${before}`,
      humanChangeAfter: `${label} (${band.currency}) — p50 ${after} (n=${band.current.n})`,
    },
  });
  return changeId;
}

/**
 * A competitor that published no pay and now does.
 *
 * Emitted once, permanently deduped on the anchor. The EU pay transparency
 * directive (transposition deadline 7 June 2026) makes this a common event across
 * European boards over the coming year, and the first board to start is a read on
 * how a competitor intends to compete for people — which is why it is worth a signal
 * even though nothing about the product changed.
 */
async function evaluateDisclosure(
  competitorId: string,
  name: string,
  competitorUrl: string | null,
): Promise<string | null> {
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      disclosed: sql<number>`count(*) filter (
        where ${jobPostings.salaryMin} is not null or ${jobPostings.salaryMax} is not null
      )::int`,
      currency: sql<string | null>`mode() within group (order by ${jobPostings.salaryCurrency})`,
    })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true)));

  if (!stats) return null;
  if (disclosureVerdict(stats.disclosed, stats.total) !== "yes") return null;

  // Baseline: weeks in which we saw a real board and it published nothing. Without
  // it, a competitor onboarded on Monday announces on Tuesday that it has "started"
  // publishing salaries it has published for years.
  const history = await getHiringMetricsHistory(competitorId);
  const byWeek = new Map<string, number>();
  for (const row of history) {
    byWeek.set(row.week_start, (byWeek.get(row.week_start) ?? 0) + row.open_count);
  }
  const weeksWithBoard = [...byWeek.values()].filter((n) => n >= DISCLOSURE_MIN_BOARD).length;
  if (weeksWithBoard < DISCLOSURE_MIN_WEEKS) {
    logger.log("Not enough board history to call disclosure a change", {
      competitorId,
      weeksWithBoard,
    });
    return null;
  }

  // Every posting that has EVER carried pay. If any of them predates the baseline
  // window, they were already publishing and this is not a start.
  const [first] = await db
    .select({ at: sql<string | null>`min(${jobPostings.detectedAt})` })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        sql`(${jobPostings.salaryMin} is not null or ${jobPostings.salaryMax} is not null)`,
      ),
    );
  const firstDisclosedAt = first?.at ? new Date(first.at) : null;
  if (!firstDisclosedAt) return null;

  const share = Math.round((stats.disclosed / stats.total) * 100);
  const currency = stats.currency ?? null;
  // A board where most roles now carry pay is a policy; a third of it is a start.
  const severity: "low" | "medium" = stats.disclosed / stats.total >= 0.5 ? "medium" : "low";

  const diffText =
    `${name} has started publishing salaries: ${stats.disclosed} of its ${stats.total} ` +
    `open roles now carry a pay range${currency ? ` (${currency})` : ""}.\n\n` +
    `No role on their board carried pay before ${firstDisclosedAt.toISOString().slice(0, 10)}, ` +
    `across ${weeksWithBoard} weeks in which they had at least ${DISCLOSURE_MIN_BOARD} ` +
    `roles open. The EU pay transparency directive (2023/970, transposition deadline ` +
    `7 June 2026) requires the pay range to appear in the advert or before the first ` +
    `interview, so this is the change many European employers are making right now — ` +
    `and whoever discloses first sets the number candidates compare everyone else to.`;

  const changeId = await writeAnchoredChange(
    competitorId,
    "disclosure:started",
    diffText,
    {
      kind: "salary_disclosure_started",
      disclosed: stats.disclosed,
      total: stats.total,
      share,
      currency,
      weeksWithBoard,
    },
    competitorUrl,
  );
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "hiring" as const,
      severity,
      is_significant: true,
      reason: `${name} started publishing salary ranges on its job board`,
      humanChangeBefore: "No salaries published",
      humanChangeAfter:
        `Now publishing salaries — ${stats.disclosed} of ${stats.total} open roles` +
        `${currency ? ` (${currency})` : ""}`,
    },
  });
  return changeId;
}

/**
 * Write the synthetic anchor → snapshot → change chain the signal hangs off, the
 * same shape detect-hiring-footprint and mine-job-facts use. Returns null when this
 * exact fact was already emitted.
 *
 * Dedup is against EVERY snapshot on the anchor, not just the latest: two kinds
 * share this chain, so "the previous one was different" would let a band re-announce
 * itself the moment a disclosure snapshot landed in between. `salary_disclosure_started`
 * carries no week in its key and is therefore deduped for the competitor's lifetime;
 * band shifts carry theirs, and the cooldown above is what keeps a sustained move
 * from re-firing week after week.
 *
 * R2 before DB: snapshots.r2Key is NOT NULL, and the body IS the text the insight
 * will be grounded on.
 */
async function writeAnchoredChange(
  competitorId: string,
  key: string,
  diffText: string,
  rawDiff: Record<string, unknown>,
  competitorUrl: string | null,
): Promise<string | null> {
  let monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "hiring_salary")),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId,
        sourceType: "hiring_salary",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure hiring_salary monitor");

  const contentHash = computeHash(key);
  const already = await db.query.snapshots.findFirst({
    where: and(eq(snapshots.monitorId, monitor.id), eq(snapshots.contentHash, contentHash)),
  });
  if (already) return null;

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  const now = new Date();
  const r2Key = `snapshots/${competitorId}/hiring_salary/${now.toISOString()}`;
  await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      monitorId: monitor.id,
      r2Key,
      contentHash,
      status: "success",
      scrapedAt: now,
      resolvedUrl: competitorUrl,
    })
    .returning();
  if (!snapshot) throw new Error("Failed to insert hiring_salary snapshot");

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: monitor.id,
      snapshotBeforeId: prevSnapshot?.id ?? null,
      snapshotAfterId: snapshot.id,
      diffText,
      diffType: "text",
      rawDiff,
      detectedAt: now,
    })
    .returning();
  if (!change) throw new Error("Failed to insert hiring_salary change");
  return change.id;
}

/** "68 000 EUR" — compact, and never converted. */
function money(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("en-US").format(amount)} ${currency}`;
}

function range(min: number | null, max: number | null, currency: string): string {
  if (min != null && max != null && min !== max) {
    return `${new Intl.NumberFormat("en-US").format(min)}–${money(max, currency)}`;
  }
  return money((min ?? max) as number, currency);
}
