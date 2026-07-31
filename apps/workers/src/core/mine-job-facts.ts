import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  snapshots,
  changes,
  jobPostings,
  postingFacts,
} from "@outrival/db";
import { computeHash, uploadToR2, normalizeDepartment } from "@outrival/shared";
import { mineJobFacts as mineJobFactsAi, AI_CONFIG } from "@outrival/ai";
import {
  applyFactGuards,
  MINED_BUCKETS,
  type MinedFact,
} from "@outrival/scrapers/jobs-jd-facts";
import { loggedAi } from "../lib/analytics";

/**
 * Mine facts out of newly-captured job descriptions, then turn the corroborated
 * ones into signals (Hiring Intelligence v2 P1).
 *
 * Triggered off extract-jobs per competitor — never a cron, and never on the
 * archive backfill path (backfill only replays homepage/pricing). Two signals
 * come out of it, both anchored on the dedicated `job_facts` monitor:
 *
 *  - tech_adoption — DETERMINISTIC. A technology named in ≥2 distinct postings is
 *    a real adoption, not one engineer's wish list; it corroborates whatever the
 *    tech-stack scraper sees from outside. Medium, category `product`.
 *  - product_hint — the weeks-of-lead one: an initiative the competitor described
 *    in a JD and has not announced. Medium on a single occurrence, promoted to
 *    high only when corroborated (a second posting, or a recent subdomain / docs /
 *    changelog move). Never critical, and never promoted on a competitor's first
 *    jobs capture — a whole board arriving at once is not evidence of anything.
 *
 * Cost is bounded from three sides: only the engineering/product/data buckets are
 * read, only postings never mined before, and at most MAX_JDS_PER_RUN of them per
 * run (the rest are picked up by the next one).
 */

const InputSchema = z.object({ competitorId: z.string() });

/** JDs sent to the model in one call. */
const BATCH_SIZE = 10;
/** Ceiling per run. A 60-role board finishes over two runs, never in one bill. */
const MAX_JDS_PER_RUN = 40;
/** How far back a sibling source's move still corroborates a product hint. */
const CORROBORATION_WINDOW_DAYS = 30;
/** Sources whose recent movement independently backs an unannounced initiative. */
const CORROBORATING_SOURCES = ["subdomains", "docs", "changelog"] as const;
/** At most this many techs / hints are named in one signal. */
const MAX_SIGNALLED = 5;

const MINED_BUCKET_SET = new Set<string>(MINED_BUCKETS);

interface Candidate {
  id: string;
  title: string;
  url: string | null;
  description: string;
}

export async function runMineJobFacts(payload: z.input<typeof InputSchema>) {
  const { competitorId } = InputSchema.parse(payload);
  logger.log("Starting mine-job-facts", { competitorId });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };
  // Mining our own product's JDs would spend AI to tell the user what they wrote,
  // and a "they're adopting Kubernetes" signal about yourself is noise. Same rule
  // detect-hiring-velocity-shifts applies.
  if (competitor.type === "self") return { skipped: true, reason: "self" };

  // Unmined postings with a body. `facts_mined_at` is what makes this repeatable:
  // a JD that yielded nothing is still marked, so it is never re-sent.
  const unmined = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      department: jobPostings.department,
      url: jobPostings.url,
      description: jobPostings.descriptionText,
    })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        eq(jobPostings.isActive, true),
        isNotNull(jobPostings.descriptionText),
        isNull(jobPostings.factsMinedAt),
      ),
    )
    .orderBy(desc(jobPostings.detectedAt))
    .limit(MAX_JDS_PER_RUN * 3);

  // Bucket filter in code (normalizeDepartment is the same classifier hiring
  // velocity uses, so "Software Engineering" and "R&D" land in one bucket).
  const candidates: Candidate[] = unmined
    .filter((p) => MINED_BUCKET_SET.has(normalizeDepartment(p.department, null, p.title)))
    .slice(0, MAX_JDS_PER_RUN)
    .map((p) => ({ id: p.id, title: p.title, url: p.url, description: p.description! }));

  if (candidates.length === 0) {
    logger.log("No unmined engineering/product/data postings", { competitorId });
    return { mined: 0, facts: 0, emitted: 0 };
  }

  // ── Mine ────────────────────────────────────────────────────────────────────
  const mined = new Map<string, MinedFact[]>();
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const result = await loggedAi(
      "mine_job_facts",
      AI_CONFIG.classification,
      () => mineJobFactsAi(batch.map((c) => ({ title: c.title, description: c.description }))),
      { competitorId },
    );
    if (!result) {
      // A parse miss loses this batch, not the run: the postings stay unmined and
      // the next capture retries them.
      logger.warn("Job-facts batch returned nothing", { competitorId, batch: batch.length });
      continue;
    }
    for (const entry of result.postings) {
      const posting = batch[entry.index];
      if (!posting) continue; // an index the model invented
      const kept = applyFactGuards(
        posting.description,
        entry.facts.map((f) => ({
          kind: f.kind,
          value: f.value,
          evidenceSnippet: f.evidence_snippet,
          confidence: f.confidence ?? null,
        })),
      );
      const dropped = entry.facts.length - kept.length;
      if (dropped > 0) {
        logger.log("Facts dropped by the deterministic guards", {
          competitorId,
          postingId: posting.id,
          proposed: entry.facts.length,
          kept: kept.length,
        });
      }
      if (kept.length > 0) mined.set(posting.id, kept);
    }
  }

  const rows = Array.from(mined.entries()).flatMap(([postingId, facts]) =>
    facts.map((f) => ({
      postingId,
      competitorId,
      kind: f.kind,
      value: f.value,
      valueKey: f.valueKey,
      evidenceSnippet: f.evidenceSnippet,
      confidence: f.confidence,
    })),
  );
  if (rows.length > 0) {
    await db.insert(postingFacts).values(rows).onConflictDoNothing();
  }
  // Mark EVERY candidate we sent, including the barren ones — that is the point.
  await db
    .update(jobPostings)
    .set({ factsMinedAt: new Date() })
    .where(inArray(jobPostings.id, candidates.map((c) => c.id)));

  logger.log("Mined job descriptions", {
    competitorId,
    postings: candidates.length,
    facts: rows.length,
  });

  // ── Signals ─────────────────────────────────────────────────────────────────
  const emitted: string[] = [];
  const tech = await emitTechAdoption(competitor.id, competitor.name);
  if (tech) emitted.push(tech);
  const hint = await emitProductHints(competitor.id, competitor.name);
  if (hint) emitted.push(hint);

  logger.log("Completed mine-job-facts", {
    competitorId,
    postings: candidates.length,
    facts: rows.length,
    emitted: emitted.length,
  });
  return { mined: candidates.length, facts: rows.length, emitted: emitted.length };
}

interface FactRow {
  id: string;
  value: string;
  valueKey: string;
  evidenceSnippet: string;
  postingId: string;
  title: string;
  url: string | null;
  signalledAt: Date | null;
}

/** All facts of one kind for a competitor, joined to the posting that carries them. */
async function factsOfKind(competitorId: string, kind: string): Promise<FactRow[]> {
  return db
    .select({
      id: postingFacts.id,
      value: postingFacts.value,
      valueKey: postingFacts.valueKey,
      evidenceSnippet: postingFacts.evidenceSnippet,
      postingId: postingFacts.postingId,
      title: jobPostings.title,
      url: jobPostings.url,
      signalledAt: postingFacts.signalledAt,
    })
    .from(postingFacts)
    .innerJoin(jobPostings, eq(jobPostings.id, postingFacts.postingId))
    .where(and(eq(postingFacts.competitorId, competitorId), eq(postingFacts.kind, kind)));
}

/**
 * A technology cited in ≥2 DISTINCT postings. Deterministic end to end: the model
 * only ever named the technology and quoted the sentence.
 *
 * Fires once per technology, ever. The gate is "no fact for this value has been
 * signalled yet" rather than a count, so a third and fourth posting citing the
 * same stack never re-announce it.
 */
async function emitTechAdoption(competitorId: string, name: string): Promise<string | null> {
  const facts = await factsOfKind(competitorId, "tech");
  if (facts.length === 0) return null;

  const byValue = new Map<string, FactRow[]>();
  for (const f of facts) {
    const arr = byValue.get(f.valueKey) ?? [];
    arr.push(f);
    byValue.set(f.valueKey, arr);
  }

  const qualifying = Array.from(byValue.values())
    .filter((group) => {
      if (group.some((f) => f.signalledAt !== null)) return false;
      return new Set(group.map((f) => f.postingId)).size >= 2;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_SIGNALLED);
  if (qualifying.length === 0) return null;

  const lines = qualifying.map((group) => {
    const titles = Array.from(new Set(group.map((f) => f.title))).slice(0, 3);
    return (
      `- ${group[0]!.value} — cited in ${new Set(group.map((f) => f.postingId)).size} job ` +
      `descriptions (${titles.join("; ")}).\n  "${group[0]!.evidenceSnippet}"`
    );
  });
  const values = qualifying.map((g) => g[0]!.value);
  const diffText =
    `${name} is hiring against a named technology stack:\n${lines.join("\n")}\n\n` +
    `A technology a company asks for across several roles is one it has committed ` +
    `to, months before it appears on their site. Each line above is quoted verbatim ` +
    `from the job description it came from.`;

  const changeId = await writeAnchoredChange(competitorId, "tech", values, diffText, {
    techs: qualifying.map((g) => ({
      value: g[0]!.value,
      postings: new Set(g.map((f) => f.postingId)).size,
    })),
  });
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "product" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${name} names ${values.slice(0, 3).join(", ")} across multiple open roles`,
      humanChangeBefore: "Not named in their job descriptions",
      humanChangeAfter: `${values.slice(0, 3).join(", ")} required across ${
        new Set(qualifying.flatMap((g) => g.map((f) => f.postingId))).size
      } roles`,
    },
  });

  await markSignalled(qualifying.flatMap((g) => g.map((f) => f.id)));
  return changeId;
}

/**
 * An initiative a competitor described in a JD and has not announced.
 *
 * Every hint here already passed the novelty pre-filter and the substring check,
 * so what remains to decide is how loud it is. Medium says "worth reading". High
 * says "act on it", and that needs a second, INDEPENDENT observation: another
 * posting saying the same thing, or a subdomain / docs page / changelog entry
 * that moved in the last month. A competitor's first jobs capture never promotes
 * — every posting is new on that run, so "two postings" would mean nothing.
 */
async function emitProductHints(competitorId: string, name: string): Promise<string | null> {
  const facts = await factsOfKind(competitorId, "product_hint");
  const fresh = facts.filter((f) => f.signalledAt === null);
  if (fresh.length === 0) return null;

  const [baseline, corroboratedBySibling] = await Promise.all([
    hasPriorJobsCapture(competitorId),
    hasRecentSiblingMove(competitorId),
  ]);

  const countsByValue = new Map<string, number>();
  for (const f of facts) {
    countsByValue.set(f.valueKey, (countsByValue.get(f.valueKey) ?? 0) + 1);
  }

  const picked = fresh.slice(0, MAX_SIGNALLED);
  const repeated = picked.some((f) => (countsByValue.get(f.valueKey) ?? 0) >= 2);
  const corroborated = baseline && (repeated || corroboratedBySibling);
  const severity: "medium" | "high" = corroborated ? "high" : "medium";

  const lines = picked.map(
    (f) => `- ${f.value} — from "${f.title}"${f.url ? ` (${f.url})` : ""}.\n  "${f.evidenceSnippet}"`,
  );
  const diffText =
    `${name} describes work in its job postings that it has not announced:\n${lines.join("\n")}\n\n` +
    (corroborated
      ? `Corroborated: ${
          repeated
            ? "the same initiative appears in more than one posting"
            : `a subdomain, documentation page or changelog entry moved in the last ${CORROBORATION_WINDOW_DAYS} days`
        }.\n\n`
      : "") +
    `Each line is quoted verbatim from the job description it came from; the ` +
    `posting is linked so the wording can be read in full.`;

  const changeId = await writeAnchoredChange(
    competitorId,
    "hint",
    picked.map((f) => f.valueKey),
    diffText,
    {
      hints: picked.map((f) => ({ value: f.value, postingId: f.postingId, url: f.url })),
      corroborated,
    },
  );
  if (!changeId) return null;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "product" as const,
      severity,
      is_significant: true,
      reason: `${name} describes ${picked[0]!.value} in a job posting it has not announced`,
      humanChangeBefore: "Not announced publicly",
      humanChangeAfter: picked[0]!.value,
    },
  });

  await markSignalled(picked.map((f) => f.id));
  return changeId;
}

async function markSignalled(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(postingFacts)
    .set({ signalledAt: new Date() })
    .where(inArray(postingFacts.id, ids));
}

/**
 * Has this competitor's board been captured before today's run? Read off the
 * jobs monitor's snapshot count: on the first capture every posting is "new",
 * which is a property of the capture, not of the competitor.
 */
async function hasPriorJobsCapture(competitorId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(snapshots)
    .innerJoin(monitors, eq(monitors.id, snapshots.monitorId))
    .where(and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "jobs")));
  return (row?.n ?? 0) > 1;
}

/** Did an independent surface move recently enough to back an unannounced build? */
async function hasRecentSiblingMove(competitorId: string): Promise<boolean> {
  const since = new Date(Date.now() - CORROBORATION_WINDOW_DAYS * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(
      and(
        eq(monitors.competitorId, competitorId),
        inArray(monitors.sourceType, [...CORROBORATING_SOURCES]),
        gte(changes.detectedAt, since),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Write the synthetic anchor → snapshot → change chain the signal hangs off, the
 * same shape detect-hiring-velocity-shifts uses. Returns the change id, or null
 * when this exact set was already emitted (a retried run must not double-signal).
 *
 * R2 before DB: `snapshots.r2Key` is NOT NULL, and the body IS the diffText the
 * insight will be grounded on.
 */
async function writeAnchoredChange(
  competitorId: string,
  kind: "tech" | "hint",
  keys: string[],
  diffText: string,
  rawDiff: Record<string, unknown>,
): Promise<string | null> {
  let monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "job_facts")),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId,
        sourceType: "job_facts",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure job_facts monitor");

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  // The kind is in the hash so the tech and hint chains can't dedup each other.
  const contentHash = computeHash(`${kind}:${[...keys].sort().join(",")}`);
  if (prevSnapshot?.contentHash === contentHash) return null;

  const now = new Date();
  const r2Key = `snapshots/${competitorId}/job_facts/${now.toISOString()}`;
  await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      monitorId: monitor.id,
      r2Key,
      contentHash,
      status: "success",
      scrapedAt: now,
    })
    .returning();
  if (!snapshot) throw new Error("Failed to insert job_facts snapshot");

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
  if (!change) throw new Error("Failed to insert job_facts change");
  return change.id;
}
