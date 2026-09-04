import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  changes,
  jobPostings,
  sqlTimestamp,
} from "@outrival/db";
import {
  computeHash,
  uploadToR2,
  normalizeDomain,
  DEPARTMENT_BUCKET_LABELS,
  isCountryKey,
} from "@outrival/shared";
import {
  detectFirstAppearances,
  detectHiringFreeze,
  FIRST_COUNTRY_MIN_WEEKS,
  NEW_DEPARTMENT_MIN_WEEKS,
  isoWeekStart,
  type DepartmentBucket,
  type WeeklyKeyRow,
} from "@outrival/scrapers/jobs-hiring";
import { getHiringGeoHistory, getHiringMetricsHistory } from "../lib/analytics";

// Hiring footprint (Hiring Intelligence v2 P2). Triggered off extract-jobs per
// competitor after an authoritative ATS scrape has upserted the week's hiring_geo
// and hiring_metrics — not a cron, and not inline in extract-jobs: that function is
// carefully ordered so a retry can not duplicate postings, and hanging three
// history-reading detectors off the end of it would put those writes behind a
// retry-on-failure they do not need.
//
// Three deterministic signals, no AI anywhere in the decision:
//   first_role_in_country   a country that appears in no prior week of their history
//   new_department_opened   a department bucket that appears in no prior week
//   hiring_freeze           a board that emptied out and did not refill
//
// All three are HIGH, and all three are claims about a FIRST or a STOP, which is
// exactly what a short history manufactures. Each therefore carries a baseline (see
// @outrival/scrapers/jobs-hiring) and each is deduped permanently by content hash,
// so a country is "first" exactly once in a competitor's life.

const InputSchema = z.object({ competitorId: z.string() });

/** Cap per run per kind. The dedup is permanent, so anything held back fires next run. */
const MAX_PER_KIND = 3;

const FREEZE_WINDOW_DAYS = Number(process.env.HIRING_FREEZE_WINDOW_DAYS ?? 14);
const FREEZE_THRESHOLDS = {
  closedRatio: Number(process.env.HIRING_FREEZE_CLOSED_RATIO ?? 0.6),
  minOpenAtStart: Number(process.env.HIRING_FREEZE_MIN_OPEN ?? 5),
  maxOpened: Number(process.env.HIRING_FREEZE_MAX_OPENED ?? 1),
};
/** Roles they must open before a second freeze can be signalled (episode re-arm). */
const FREEZE_REARM_OPENINGS = 2;

export async function runDetectHiringFootprint(payload: z.input<typeof InputSchema>) {
  const { competitorId } = InputSchema.parse(payload);
  logger.log("Starting detect-hiring-footprint", { competitorId });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };
  // "You opened your first role in Germany" about your own product is not
  // intelligence, it is a diary entry.
  if (competitor.type === "self") return { skipped: true, reason: "self" };

  const now = new Date();
  const currentWeek = isoWeekStart(now);
  const emitted: string[] = [];

  const [geoRows, bucketRows] = await Promise.all([
    getHiringGeoHistory(competitorId),
    getHiringMetricsHistory(competitorId),
  ]);

  // The week being judged is already written, so it must not count as its own
  // history — otherwise every country is a country we have always known about.
  const split = <T extends { week_start: string }>(rows: T[]) => ({
    current: rows.filter((r) => r.week_start === currentWeek),
    history: rows.filter((r) => r.week_start < currentWeek),
  });

  // ── first_role_in_country ────────────────────────────────────────────────
  const geo = split(geoRows);
  const geoHistory: WeeklyKeyRow[] = geo.history
    .filter((r) => isCountryKey(r.key))
    .map((r) => ({ key: r.key, weekStart: r.week_start }));
  const currentCountries = geo.current
    .filter((r) => isCountryKey(r.key) && r.open_count > 0)
    .map((r) => r.key);
  const newCountries = detectFirstAppearances(
    currentCountries,
    geoHistory,
    FIRST_COUNTRY_MIN_WEEKS,
  );
  if (newCountries.length > MAX_PER_KIND) {
    logger.log("Holding back first-country signals past the per-run cap", {
      competitorId,
      held: newCountries.slice(MAX_PER_KIND),
    });
  }
  for (const cc of newCountries.slice(0, MAX_PER_KIND)) {
    const changeId = await emitFirstCountry(competitorId, competitor.name, cc, competitor.url);
    if (changeId) emitted.push(`country:${cc}`);
  }

  // ── new_department_opened ────────────────────────────────────────────────
  const buckets = split(bucketRows);
  const bucketHistory: WeeklyKeyRow[] = buckets.history
    .filter((r) => r.key !== "unknown")
    .map((r) => ({ key: r.key, weekStart: r.week_start }));
  const currentBuckets = buckets.current
    .filter((r) => r.key !== "unknown" && r.open_count > 0)
    .map((r) => r.key);
  const newBuckets = detectFirstAppearances(
    currentBuckets,
    bucketHistory,
    NEW_DEPARTMENT_MIN_WEEKS,
  );
  for (const bucket of newBuckets.slice(0, MAX_PER_KIND)) {
    const changeId = await emitNewDepartment(
      competitorId,
      competitor.name,
      bucket as DepartmentBucket,
      competitor.url,
    );
    if (changeId) emitted.push(`bucket:${bucket}`);
  }

  // ── hiring_freeze ────────────────────────────────────────────────────────
  const freezeId = await evaluateFreeze(competitorId, competitor.name, competitor.url, now);
  if (freezeId) emitted.push("freeze");

  logger.log("Completed detect-hiring-footprint", { competitorId, emitted });
  return { emitted };
}

/** The role that makes a new country concrete, so the signal names one. */
async function exampleRoleInCountry(competitorId: string, cc: string) {
  const [row] = await db
    .select({ title: jobPostings.title, location: jobPostings.location, url: jobPostings.url })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        eq(jobPostings.isActive, true),
        sql`${jobPostings.countryCodes} @> ARRAY[${cc}]::text[]`,
      ),
    )
    .orderBy(desc(jobPostings.detectedAt))
    .limit(1);
  return row ?? null;
}

async function emitFirstCountry(
  competitorId: string,
  name: string,
  cc: string,
  competitorUrl: string | null,
): Promise<string | null> {
  const country = countryLabel(cc);
  const role = await exampleRoleInCountry(competitorId, cc);
  const roleLine = role
    ? `${role.title}${role.location ? ` (${role.location})` : ""}${role.url ? ` — ${role.url}` : ""}`
    : "a role on their public board";

  const diffText =
    `${name} is hiring in ${country} for the first time.\n\n` +
    `- ${roleLine}\n\n` +
    `No role in ${country} appears anywhere in the hiring history we hold for ` +
    `${name}. A company's first hire in a country is the earliest public evidence ` +
    `of a market entry — it is committed to before the office, the localised site ` +
    `or the announcement exist. The country was read from the posting's own ` +
    `location line, offline and deterministically; postings whose location we ` +
    `cannot place are counted separately and never as a country.`;

  const changeId = await writeAnchoredChange(competitorId, `country:${cc}`, diffText, {
    kind: "first_role_in_country",
    country: cc,
    role: role ? { title: role.title, location: role.location, url: role.url } : null,
  }, competitorUrl);
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "hiring" as const,
      severity: "high" as const,
      is_significant: true,
      reason: `${name} posted its first role in ${country}`,
      humanChangeBefore: `No roles in ${country}`,
      humanChangeAfter: `First role in ${country} — ${role?.title ?? "new opening"}${
        role?.location ? ` (${role.location})` : ""
      }`,
    },
  });
  return changeId;
}

async function emitNewDepartment(
  competitorId: string,
  name: string,
  bucket: DepartmentBucket,
  competitorUrl: string | null,
): Promise<string | null> {
  const label = DEPARTMENT_BUCKET_LABELS[bucket] ?? bucket;
  const [role] = await db
    .select({ title: jobPostings.title, location: jobPostings.location, url: jobPostings.url })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true)))
    .orderBy(desc(jobPostings.detectedAt))
    .limit(1);

  const diffText =
    `${name} has opened its first ${label.toLowerCase()} role.\n\n` +
    `- ${role?.title ?? "a new opening"}${role?.location ? ` (${role.location})` : ""}` +
    `${role?.url ? ` — ${role.url}` : ""}\n\n` +
    `No ${label.toLowerCase()} role appears in any earlier week of ${name}'s hiring ` +
    `history. The first hire into a function a company has never staffed says what ` +
    `they are about to be able to do — a first designer, a first sales rep or a ` +
    `first support hire each mark a different change in how they intend to compete.`;

  const changeId = await writeAnchoredChange(competitorId, `bucket:${bucket}`, diffText, {
    kind: "new_department_opened",
    bucket,
    role: role ? { title: role.title, location: role.location, url: role.url } : null,
  }, competitorUrl);
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "hiring" as const,
      severity: "high" as const,
      is_significant: true,
      reason: `${name} opened its first ${label.toLowerCase()} role`,
      humanChangeBefore: `No ${label.toLowerCase()} roles`,
      humanChangeAfter: `First ${label} role — ${role?.title ?? "new opening"}`,
    },
  });
  return changeId;
}

/**
 * A board that emptied out. Every guard here exists because the alternative — a
 * "they've frozen hiring" alert that actually fires on an ATS hiccup — is worse
 * than never shipping the signal at all.
 */
async function evaluateFreeze(
  competitorId: string,
  name: string,
  competitorUrl: string | null,
  now: Date,
): Promise<string | null> {
  const start = new Date(now.getTime() - FREEZE_WINDOW_DAYS * 86_400_000);
  // The raw sql params below go through sqlTimestamp: postgres-js cannot bind a Date
  // object once drizzle has replaced its serializers (packages/db/src/sql.ts). The
  // helpers called further down use the query builder and keep the Date itself.
  const startAt = sqlTimestamp(start);

  const [stats] = await db
    .select({
      openAtStart: sql<number>`count(*) filter (
        where ${jobPostings.detectedAt} <= ${startAt}
          and (${jobPostings.closedAt} is null or ${jobPostings.closedAt} > ${startAt})
      )::int`,
      closedInWindow: sql<number>`count(*) filter (
        where ${jobPostings.closedAt} >= ${startAt}
      )::int`,
      openedInWindow: sql<number>`count(*) filter (
        where ${jobPostings.detectedAt} >= ${startAt}
      )::int`,
      lastClosureAt: sql<string | null>`max(${jobPostings.closedAt})`,
    })
    .from(jobPostings)
    .where(eq(jobPostings.competitorId, competitorId));

  if (!stats || !stats.lastClosureAt) return null;
  const lastClosureAt = new Date(stats.lastClosureAt);

  const [confirmed, boardStable] = await Promise.all([
    hasJobsCaptureAfter(competitorId, lastClosureAt),
    isBoardStable(competitorId, start),
  ]);

  const verdict = detectHiringFreeze(
    {
      openAtStart: stats.openAtStart,
      closedInWindow: stats.closedInWindow,
      openedInWindow: stats.openedInWindow,
      confirmedByLaterRun: confirmed,
      boardStable,
    },
    FREEZE_THRESHOLDS,
  );
  if (!verdict) return null;

  // One signal per episode: once flagged, stay quiet until they have actually
  // started hiring again. Re-armed by openings, not by a clock — a board that is
  // still frozen in three weeks is the same fact, not a new one.
  const priorFreeze = await lastFreezeChange(competitorId);
  if (priorFreeze) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobPostings)
      .where(
        and(
          eq(jobPostings.competitorId, competitorId),
          gt(jobPostings.detectedAt, priorFreeze.detectedAt),
        ),
      );
    if ((row?.n ?? 0) < FREEZE_REARM_OPENINGS) {
      logger.log("Freeze still in the same episode — skipping", { competitorId });
      return null;
    }
  }

  const pct = Math.round(verdict.closedShare * 100);
  const diffText =
    `${name} has closed ${verdict.closed} of the ${verdict.openAtStart} roles that were ` +
    `open ${FREEZE_WINDOW_DAYS} days ago (${pct}%) and opened ${
      verdict.opened === 0 ? "none" : verdict.opened === 1 ? "one" : String(verdict.opened)
    } since.\n\n` +
    `A board emptying without refilling is the negative signal competitive tools ` +
    `usually miss: budget pulled, a reorg, or a round that did not close. The ` +
    `closures were confirmed by a later capture of the same board, so this is not a ` +
    `single failed read of their job feed.`;

  const changeId = await writeAnchoredChange(
    competitorId,
    `freeze:${isoWeekStart(now)}`,
    diffText,
    {
      kind: "hiring_freeze",
      openAtStart: verdict.openAtStart,
      closed: verdict.closed,
      opened: verdict.opened,
      windowDays: FREEZE_WINDOW_DAYS,
    },
    competitorUrl,
  );
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "hiring" as const,
      severity: "high" as const,
      is_significant: true,
      reason: `${name} closed ${pct}% of its open roles in ${FREEZE_WINDOW_DAYS} days without reopening`,
      humanChangeBefore: `${verdict.openAtStart} open roles`,
      humanChangeAfter: `${verdict.openAtStart - verdict.closed} open roles`,
    },
  });
  return changeId;
}

/** Did a later capture of the same board leave the closures standing? */
async function hasJobsCaptureAfter(competitorId: string, after: Date): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(snapshots)
    .innerJoin(monitors, eq(monitors.id, snapshots.monitorId))
    .where(
      and(
        eq(monitors.competitorId, competitorId),
        eq(monitors.sourceType, "jobs"),
        gt(snapshots.scrapedAt, after),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Is this the same board it was at the start of the window? Compared on the HOST of
 * the first and last capture, not on every capture in between: an ATS migration
 * moves the host for good, while a single fallback to the careers page (their API
 * was down for one run) moves it for one capture and back. Suppressing a real
 * freeze for two weeks over one blip is a worse trade than it looks, because a
 * frozen board is exactly the state that makes an ATS look flaky.
 */
async function isBoardStable(competitorId: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ resolvedUrl: snapshots.resolvedUrl, scrapedAt: snapshots.scrapedAt })
    .from(snapshots)
    .innerJoin(monitors, eq(monitors.id, snapshots.monitorId))
    .where(
      and(
        eq(monitors.competitorId, competitorId),
        eq(monitors.sourceType, "jobs"),
        gte(snapshots.scrapedAt, since),
      ),
    )
    .orderBy(snapshots.scrapedAt);
  const hosts = rows.map((r) => normalizeDomain(r.resolvedUrl)).filter(Boolean);
  if (hosts.length < 2) return true;
  return hosts[0] === hosts[hosts.length - 1];
}

/** The most recent freeze this competitor was flagged with, if any. */
async function lastFreezeChange(competitorId: string) {
  const [row] = await db
    .select({ detectedAt: changes.detectedAt })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(
      and(
        eq(monitors.competitorId, competitorId),
        eq(monitors.sourceType, "hiring_footprint"),
        sql`${changes.rawDiff}->>'kind' = 'hiring_freeze'`,
      ),
    )
    .orderBy(desc(changes.detectedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Write the synthetic anchor → snapshot → change chain the signal hangs off, the
 * same shape detect-hiring-velocity-shifts and mine-job-facts use. Returns null when
 * this exact fact was already emitted.
 *
 * Dedup is against EVERY snapshot on the anchor, not just the latest: three
 * different kinds share this chain, so "the previous one was different" — which is
 * enough when a job owns its anchor alone — would let a country announce itself
 * again the moment a freeze snapshot landed in between. A first role in Germany is
 * first exactly once.
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
    where: and(
      eq(monitors.competitorId, competitorId),
      eq(monitors.sourceType, "hiring_footprint"),
    ),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId,
        sourceType: "hiring_footprint",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure hiring_footprint monitor");

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
  const r2Key = `snapshots/${competitorId}/hiring_footprint/${now.toISOString()}`;
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
  if (!snapshot) throw new Error("Failed to insert hiring_footprint snapshot");

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
  if (!change) throw new Error("Failed to insert hiring_footprint change");
  return change.id;
}

/** "DE" → "Germany". ICU ships in every runtime we run on; no table needed. */
function countryLabel(cc: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}
