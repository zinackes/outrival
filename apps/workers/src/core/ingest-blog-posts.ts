import { logger } from "../lib/job-logger";
import {
  NonRetriable as AbortTaskRunError,
  generateSignal,
  ingestCaseStudies,
} from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  competitors,
  contentItems,
  changes,
  monitors,
  organizations,
  snapshots,
} from "@outrival/db";
import {
  computeHash,
  getFromR2,
  uploadToR2,
  detectEditorialPivot,
  topTopics,
  EDITORIAL_WINDOW_DAYS,
  type EditorialItem,
} from "@outrival/shared";
import { enrichBlogPosts, AI_CONFIG } from "@outrival/ai";
import {
  parseBlogItems,
  applyBlogGuards,
  planBlogRun,
  resolveSelfMatch,
  rivalMentions,
  type ContentItemInput,
  type KeptMention,
  type SelfIdentity,
} from "@outrival/scrapers/content";
import { fetchPostTexts, POST_FETCH_CAP, POST_FETCH_MAX_ATTEMPTS } from "@outrival/scrapers/content-fetch";
import { loggedAi } from "../lib/analytics";
import { resolveSelfIdentity } from "../lib/self-identity";
import { mergeNamedFromMentions } from "../lib/named-competitors";

/**
 * Turn a captured blog into POSTS THAT HAVE BEEN READ (Content Intelligence v2 P2).
 *
 * Until now the blog was the source a competitor publishes to most often and the
 * one we understood least: every post — a launch, a teardown of the user's own
 * product, an SEO filler page — reached the pipeline as the same few added lines on
 * an index page. This job goes and gets the new posts, one at a time, and turns
 * each into a row that says what it is, what it is about, and who it names.
 *
 * Three things bound it, and each is a rule rather than a tuning knob:
 *
 *  - THE FIRST CAPTURE IS A BASELINE. A blog's index shows everything it has ever
 *    published, so the first run would otherwise fetch thirty posts and announce
 *    that a competitor named the user in an article from 2023. The rows are
 *    written — that is the memory this feature exists to build — and nothing is
 *    fetched, enriched or signalled off them.
 *  - ONE FETCH PER NEW POST, EVER. Capped per run, sequential, and attempts are
 *    counted so a post we cannot read is dropped after two tries instead of being
 *    re-requested every week.
 *  - THE MODEL PROPOSES, CODE DECIDES. Every competitor it names is re-checked
 *    against the fetched text before it can reach a signal (`applyBlogGuards`).
 *
 * The diff → classify path is untouched: it still emits its own `content` signal on
 * a new post. `competitor_named_you` is an ADDITIONAL signal, of a different
 * category, on the one thing that diff could never say.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
});

/** Posts sent to the model in one call. */
const BATCH_SIZE = 10;
/** Competitor mentions surfaced per post — the block names them, it does not list a page. */
const MAX_MENTIONS_PER_POST = 5;

export async function runIngestBlogPosts(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-blog-posts", input);

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };

  const snapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, input.snapshotId),
  });
  if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);
  // A backdated archive capture is a listing as it stood months ago. Fetching from
  // it would read posts nobody just published, and no signal comes off a backfill.
  if (snapshot.origin === "archive") return { skipped: true, reason: "archive" };

  const html = await getFromR2(`${snapshot.r2Key}.html`);
  const parsed = parseBlogItems(html);
  if (parsed.length === 0) {
    // A blog with neither a feed nor a recognisable post listing. The rendered
    // index still diffs and still classifies — the pre-P2 path, unchanged.
    logger.log("No structured blog items in this capture", { competitorId: competitor.id });
    return { parsed: 0, inserted: 0, fetched: 0, enriched: 0, emitted: 0 };
  }

  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentItems)
    .where(
      and(eq(contentItems.competitorId, competitor.id), eq(contentItems.sourceType, "blog")),
    );

  // The rule lives in @outrival/scrapers/content, where it is tested: a blog we
  // have never seen is baselined, never read.
  const plan = planBlogRun({ heldRows: existing?.n ?? 0, items: parsed });
  if (plan.mode === "baseline") {
    const seeded = await insertItems(competitor.id, plan.seed, { markSeen: true });
    logger.log("Blog baseline written — no fetch, no enrichment, no signal", {
      competitorId: competitor.id,
      seeded,
    });
    return {
      parsed: parsed.length,
      inserted: seeded,
      baseline: true,
      fetched: 0,
      enriched: 0,
      emitted: 0,
    };
  }

  const inserted = await insertItems(competitor.id, plan.items);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  // Anything unread and still within its attempt budget, newest first — including
  // posts a previous run could not reach. New posts lead because they are dated
  // later, so a backlog never starves this week's publication.
  const pending = await db
    .select({ id: contentItems.id, url: contentItems.url, title: contentItems.title })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.competitorId, competitor.id),
        eq(contentItems.sourceType, "blog"),
        isNull(contentItems.enrichedAt),
        isNotNull(contentItems.url),
        lt(contentItems.enrichAttempts, POST_FETCH_MAX_ATTEMPTS),
      ),
    )
    .orderBy(sql`${contentItems.publishedAt} desc nulls last`, desc(contentItems.firstSeenAt))
    .limit(POST_FETCH_CAP);

  if (pending.length === 0) {
    // Still evaluated: the two windows a pivot compares SLIDE, so the shape can
    // move on a week where nothing new was published. The read is one indexed
    // query and it costs nothing when there is nothing to compare.
    const pivoted = await emitEditorialPivot(competitor, snapshot.id);
    logger.log("Completed ingest-blog-posts — nothing new to read", {
      competitorId: competitor.id,
      inserted,
      pivoted,
    });
    return { parsed: parsed.length, inserted, fetched: 0, enriched: 0, emitted: 0, pivoted };
  }

  const { fetched, failed } = await fetchPostTexts(
    pending.map((p) => ({ id: p.id, url: p.url! })),
  );
  // Every post we went out for costs an attempt, read or not: a batch the model
  // fails to parse must not send us back to the same twenty pages next week.
  await db
    .update(contentItems)
    .set({ enrichAttempts: sql`${contentItems.enrichAttempts} + 1` })
    .where(inArray(contentItems.id, pending.map((p) => p.id)));
  if (failed.length > 0) {
    logger.log("Posts we could not read", {
      competitorId: competitor.id,
      failed: failed.length,
      reasons: Array.from(new Set(failed.map((f) => f.reason))).slice(0, 5),
    });
  }

  // ── Enrich ──────────────────────────────────────────────────────────────────
  const titleById = new Map(pending.map((p) => [p.id, p.title]));
  // Resolved once, before the loop, because it decides which sentence each row
  // stores as its quote — the block a `named_you` signal shows has to be the
  // sentence about the READER, not whichever competitor the post named first.
  // A post on our own blog naming a competitor is us, not news about them: no
  // identity is resolved and no signal is emitted, but the rows are still written
  // (P4's editorial reads compare the two).
  const identity = await resolveSelfIdentity(competitor.orgId);
  const self: SelfIdentity | null = competitor.type === "self" ? null : identity;
  const named: Array<{ id: string; url: string; title: string; snippet: string }> = [];
  /** Rivals these posts named (Positioning v2 P2), handed to the market map. */
  const mentioned: Array<{ sourceType: string; url: string | null; mentions: string[] }> = [];
  /** Posts this run read as customer stories (P3), handed to the customers path. */
  const caseStudyItemIds: string[] = [];
  let enrichedCount = 0;

  for (let i = 0; i < fetched.length; i += BATCH_SIZE) {
    const batch = fetched.slice(i, i + BATCH_SIZE);
    const result = await loggedAi(
      "enrich_blog_posts",
      AI_CONFIG.classification,
      () =>
        enrichBlogPosts(
          batch.map((p) => ({ title: titleById.get(p.id) ?? "", text: p.text })),
        ),
      { competitorId: competitor.id },
    );
    if (!result) {
      // A parse miss loses this batch, not the run. The posts keep their remaining
      // attempt and the next capture retries them.
      logger.warn("Blog enrichment batch returned nothing", {
        competitorId: competitor.id,
        batch: batch.length,
      });
      continue;
    }

    for (const entry of result.posts) {
      const post = batch[entry.index];
      if (!post) continue; // an index the model invented
      const guarded = applyBlogGuards(post.text, {
        itemType: entry.item_type,
        topics: entry.topics,
        products: entry.products,
        personas: entry.personas,
        competitorsNamed: entry.companies_named.map((m) => ({
          name: m.name,
          snippet: m.snippet ?? null,
          relationship: m.relationship ?? null,
        })),
        summary: entry.summary,
      });

      // Which of the named companies is the reader themselves. Decided here, so
      // the sentence stored as the row's quote is the one about them: a post that
      // names three rivals would otherwise file the first mention's sentence, and
      // the alert would show the reader a quote about somebody else.
      //
      // Scanned across EVERY kept mention, not just the rivals: a competitor naming
      // the reader is news whether the post calls them a rival, a customer or an
      // integration, and `competitor_named_you` is the one alert here that is
      // `critical`.
      const mine: KeptMention | undefined = self
        ? guarded.mentions.find(
            (m) => resolveSelfMatch({ mention: m.name, postText: post.text, self }) !== null,
          )
        : undefined;

      // The market map takes positioning facts only. A post naming the customers
      // running on the product names companies, not rivals, and filing those is what
      // put airlines and streaming services on a container registry's market map.
      const rivals = rivalMentions(guarded.mentions).slice(0, MAX_MENTIONS_PER_POST);

      await db
        .update(contentItems)
        .set({
          itemType: guarded.itemType,
          topics: guarded.topics,
          products: guarded.products,
          personas: guarded.personas,
          // The column is `competitors_named` and now holds exactly that: the
          // backfill script reads it straight into the registry, so a customer
          // stored here is a customer on somebody's market map.
          competitorsNamed: rivals.map((m) => m.name),
          summary: guarded.summary,
          // The publisher's words or nothing, substring-verified above.
          evidenceSnippet: mine?.snippet ?? guarded.mentions[0]?.snippet ?? null,
          enrichedAt: new Date(),
        })
        .where(eq(contentItems.id, post.id));

      enrichedCount++;
      // Positioning Intelligence v2 P2 — the rivals this post named go into the
      // market map. Already extracted and already paid for above: until now they
      // sat in an array column nothing queried. Registry only, never a signal.
      if (rivals.length > 0) {
        mentioned.push({ sourceType: "blog", url: post.url, mentions: rivals.map((m) => m.name) });
      }
      // Content Intelligence v2 P3 — a post the model just read as a customer story
      // is one, and the customers path knows what to do with it. The URL goes over,
      // not the text: that job re-reads the page itself, so what it stores as a
      // verbatim metric is checked against the page it actually holds.
      if (guarded.itemType === "case_study") caseStudyItemIds.push(post.id);
      if (mine) {
        named.push({
          id: post.id,
          url: post.url,
          title: titleById.get(post.id) ?? "",
          snippet: mine.snippet,
        });
      }
    }
  }

  // Content Intelligence v2 P3 — hand the customer stories over. Fired even on a
  // capture that emitted no `named_you`, and never on a baseline (that path returns
  // long before here), so a blog's back catalogue is never read as fresh wins.
  if (caseStudyItemIds.length > 0) {
    await ingestCaseStudies.enqueue({
      snapshotId: snapshot.id,
      competitorId: competitor.id,
      contentItemIds: caseStudyItemIds,
    });
  }

  // Positioning Intelligence v2 P2 — merge those mentions into the market map.
  // Before the signals, because it emits none of its own: who a company writes
  // about is a fact about their positioning, not an event.
  const mapped = await mergeNamedFromMentions(competitor.id, mentioned, {
    self: identity,
    owner: { name: competitor.name, url: competitor.url },
  });

  // ── Signal ──────────────────────────────────────────────────────────────────
  let emitted = 0;
  for (const post of named) {
    const ok = await emitNamedYou({ competitor, snapshotId: snapshot.id, ...post, itemId: post.id });
    if (ok) emitted++;
  }

  // Content Intelligence v2 P4 — last, because it reads back what this run just
  // wrote: the posts enriched above are part of the current window it measures.
  const pivoted = await emitEditorialPivot(competitor, snapshot.id);

  logger.log("Completed ingest-blog-posts", {
    competitorId: competitor.id,
    inserted,
    fetched: fetched.length,
    enriched: enrichedCount,
    caseStudies: caseStudyItemIds.length,
    mapped,
    emitted,
    pivoted,
  });
  return {
    parsed: parsed.length,
    inserted,
    fetched: fetched.length,
    enriched: enrichedCount,
    mapped,
    emitted,
    pivoted,
  };
}

type CompetitorRow = typeof competitors.$inferSelect;

/**
 * Write what this capture shows and report how many rows were NEW.
 *
 * Uniqueness is (competitor, source, external_id), so re-reading the same feed
 * inserts nothing. A post is never updated in place: its title can be edited, and
 * an edit is not a publication.
 *
 * The ONE exception is a `published_at` we never had. A row with no date is dated
 * from the day we first saw it everywhere downstream — the timeline, the cadence
 * chart, the pivot windows — so a listing that only later hands us the real date
 * has to be able to correct it. Filling a NULL is not an edit; it is the record
 * completing. A date we already hold is never overwritten.
 *
 * `markSeen` is the baseline: `enrichedAt` is stamped so those rows leave the fetch
 * queue permanently. They are not "read and found empty" — they are the state the
 * blog was in when we arrived, and the point of a baseline is that everything after
 * it is genuinely new.
 */
export async function insertItems(
  competitorId: string,
  items: ReadonlyArray<ContentItemInput>,
  options: { markSeen?: boolean } = {},
): Promise<number> {
  if (items.length === 0) return 0;
  const seenAt = options.markSeen ? new Date() : null;
  const rows = await db
    .insert(contentItems)
    .values(
      items.map((it) => ({
        competitorId,
        sourceType: "blog",
        externalId: it.externalId,
        title: it.title,
        url: it.url,
        publishedAt: it.publishedAt ? new Date(it.publishedAt) : null,
        enrichedAt: seenAt,
      })),
    )
    .onConflictDoUpdate({
      target: [contentItems.competitorId, contentItems.sourceType, contentItems.externalId],
      set: { publishedAt: sql`excluded.published_at` },
      setWhere: sql`${contentItems.publishedAt} is null and excluded.published_at is not null`,
    })
    // `xmax = 0` is true only for the rows this statement INSERTED, so a repaired
    // date is not reported as a publication.
    .returning({ id: contentItems.id, isNew: sql<boolean>`xmax = 0` });
  return rows.filter((r) => r.isNew).length;
}

/**
 * `competitor_named_you`: a competitor's own post names the user's product.
 *
 * Anchored on the per-competitor `comparison_page` monitor, which is what makes the
 * `critical` stick — applySeverityGuard allows a content/critical from that source
 * and only from it, because it is the one place where the severity is decided in
 * code rather than proposed by a model. Anchoring on the blog change instead would
 * be quietly demoted to `high`, AND would collide with the lexical classifier's own
 * signal on the same change (signals.changeId is unique — one of the two would
 * silently lose).
 *
 * Dedup is by URL across the whole anchor, so a page the sitemap source already
 * caught as a `/vs/` page never earns a second alert when the blog reaches it too.
 */
async function emitNamedYou(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  itemId: string;
  url: string;
  title: string;
  snippet: string;
}): Promise<boolean> {
  const { competitor, url, title, snippet } = args;

  let anchor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitor.id),
      eq(monitors.sourceType, "comparison_page"),
    ),
  });
  if (!anchor) {
    [anchor] = await db
      .insert(monitors)
      .values({
        competitorId: competitor.id,
        sourceType: "comparison_page",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!anchor) throw new Error("Failed to ensure comparison_page monitor");

  const [seen] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(changes)
    .where(
      and(eq(changes.monitorId, anchor.id), sql`${changes.rawDiff}->>'comparisonUrl' = ${url}`),
    );
  if ((seen?.n ?? 0) > 0) return false;

  const diffText =
    `${competitor.name} published a post that names your product: "${title}" — ${url}\n\n` +
    `From the post itself:\n"${snippet}"\n\n` +
    `A competitor writing about you by name is a live commercial action: the post is ` +
    `what their sales team will send, and what a prospect searching for you will read.`;

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      // The blog capture IS the evidence, so it is the "after" side — the same
      // shape the sitemap branch uses when it writes onto this anchor.
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "competitor_named_you",
        comparisonUrl: url,
        source: "blog",
        contentItemId: args.itemId,
        targetsOrg: true,
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      category: "content" as const,
      severity: "critical" as const,
      is_significant: true,
      reason: `${competitor.name} names your product in a published post: "${title}"`,
      humanChangeBefore: null,
      humanChangeAfter: `${competitor.name} mentions you — "${title}"`,
    },
  });

  await db
    .update(monitors)
    .set({ lastChangedAt: new Date() })
    .where(eq(monitors.id, anchor.id));
  return true;
}

/** Days a competitor stays quiet after an editorial_pivot. One window's length. */
const PIVOT_COOLDOWN_DAYS = EDITORIAL_WINDOW_DAYS;

/** Topics each side of the move names in the human-readable lines. */
const PIVOT_TOPICS_SHOWN = 3;

/**
 * `editorial_pivot`: what a competitor writes about has moved.
 *
 * DETERMINISTIC end to end — this phase adds no AI call anywhere. The topics were
 * extracted and substring-checked by P2; everything here is counting them, and the
 * decision is a Jensen-Shannon divergence computed in `@outrival/shared`, where its
 * thresholds are tested.
 *
 * Four gates, in the order they get cheaper to fail:
 *
 *  - NEVER ON THE SELF PRODUCT. The rows are written for the user's own blog too
 *    (the Content tab compares them), but "you repositioned" is not news to them.
 *  - THE MINIMUMS live in the detector: eight READ posts in each 90-day window and
 *    five distinct topics across the two. A blog at two posts a month cannot pivot
 *    statistically — its distribution swings on a single post.
 *  - A 90-DAY COOLDOWN, read off the anchor's own snapshot chain, so a repositioning
 *    that holds is one piece of news rather than one per capture while it lasts.
 *  - CONTENT-HASH DEDUP on the same chain, so a retried run inside one day cannot
 *    write the move twice.
 *
 * Worth stating rather than discovering: this cannot fire until a competitor has
 * roughly six months of tracking behind them, because posts predating P2 were
 * baselined and never opened, and an unopened post carries no topics. That is the
 * design. The alternative compares what we know now against a window we never read,
 * which would report a pivot at every competitor the day the feature ships.
 */
async function emitEditorialPivot(
  competitor: CompetitorRow,
  snapshotId: string,
): Promise<boolean> {
  if (competitor.type === "self") return false;

  const since = new Date(Date.now() - 2 * EDITORIAL_WINDOW_DAYS * 86_400_000);
  // `topics is not null` IS "we opened this post": applyBlogGuards always writes an
  // array (possibly empty), while the baseline insert never touches the column. A
  // baselined back catalogue would otherwise clear the post floor with posts nobody
  // has read, leaving the whole comparison resting on a handful of topics.
  const rows = await db
    .select({
      sourceType: contentItems.sourceType,
      itemType: contentItems.itemType,
      topics: contentItems.topics,
      publishedAt: contentItems.publishedAt,
      firstSeenAt: contentItems.firstSeenAt,
    })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.competitorId, competitor.id),
        eq(contentItems.sourceType, "blog"),
        isNotNull(contentItems.topics),
        // Either date reaching into the span keeps the row; the detector then
        // places each one on published_at ?? first_seen_at.
        or(
          gte(contentItems.publishedAt, since),
          gte(contentItems.firstSeenAt, since),
        ),
      ),
    );

  const pivot = detectEditorialPivot(rows as EditorialItem[]);
  if (!pivot) return false;

  const anchor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitor.id),
      eq(monitors.sourceType, "editorial_shift"),
    ),
  });
  if (anchor) {
    const cooldownSince = new Date(Date.now() - PIVOT_COOLDOWN_DAYS * 86_400_000);
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(snapshots)
      .where(and(eq(snapshots.monitorId, anchor.id), gte(snapshots.scrapedAt, cooldownSince)));
    if ((recent?.n ?? 0) > 0) return false;
  }

  const rising = pivot.rising.slice(0, PIVOT_TOPICS_SHOWN).map((t) => t.topic);
  const declining = pivot.declining.slice(0, PIVOT_TOPICS_SHOWN).map((t) => t.topic);
  // A move with nothing on one side is a broadening or a narrowing, not a pivot the
  // reader can act on, and the sentence would read "rising: — ".
  if (rising.length === 0 || declining.length === 0) return false;

  const nowTopics = topTopics(pivot.current);
  const thenTopics = topTopics(pivot.previous);
  const line = (list: Array<{ topic: string; count: number }>) =>
    list.map((t) => `${t.topic} (${t.count})`).join(", ");

  const diffText =
    `${competitor.name}'s blog has changed subject. Over the last ${EDITORIAL_WINDOW_DAYS} days ` +
    `they published ${pivot.current.posts} posts we read; over the ${EDITORIAL_WINDOW_DAYS} before ` +
    `that, ${pivot.previous.posts}. The mix of subjects between the two windows diverges by ` +
    `${pivot.divergence.toFixed(2)} on a 0-to-1 scale.\n\n` +
    `Rising: ${rising.join(", ")}\n` +
    `Declining: ${declining.join(", ")}\n\n` +
    `Now (${pivot.current.posts} posts): ${line(nowTopics)}\n` +
    `Before (${pivot.previous.posts} posts): ${line(thenTopics)}\n\n` +
    `Counted from the topics of their own posts, one post per row. What a company ` +
    `chooses to publish about is the cheapest early read on what it is selling next ` +
    `and who it is selling to.`;

  const changeId = await writeEditorialChange(
    competitor,
    snapshotId,
    `editorial:${new Date().toISOString().slice(0, 10)}:${rising.join("|")}`,
    diffText,
    {
      kind: "editorial_pivot",
      divergence: pivot.divergence,
      windowDays: EDITORIAL_WINDOW_DAYS,
      currentPosts: pivot.current.posts,
      previousPosts: pivot.previous.posts,
      distinctTopics: pivot.distinctTopics,
      currentTopics: nowTopics,
      previousTopics: thenTopics,
      rising: pivot.rising.map((t) => ({ topic: t.topic, now: t.now, then: t.then })),
      declining: pivot.declining.map((t) => ({ topic: t.topic, now: t.now, then: t.then })),
    },
  );
  if (!changeId) return false;

  await generateSignal.enqueue({
    changeId,
    classification: {
      // The nearest existing category, and the right one: this is a read of what
      // they publish. The enum is not extended for it.
      category: "content" as const,
      // An aggregate over a quarter of posts. Never critical — that band bypasses
      // every moderation layer and mails within minutes, which a slow-moving shift
      // in editorial subject has not earned.
      severity: "medium" as const,
      is_significant: true,
      reason:
        `Editorial shift — rising: ${rising.join(", ")} · declining: ${declining.join(", ")}`,
      humanChangeBefore: thenTopics
        .slice(0, PIVOT_TOPICS_SHOWN)
        .map((t) => t.topic)
        .join(", "),
      humanChangeAfter: nowTopics
        .slice(0, PIVOT_TOPICS_SHOWN)
        .map((t) => t.topic)
        .join(", "),
    },
  });
  return true;
}

/**
 * The synthetic `editorial_shift` anchor chain, the same shape the velocity and
 * customer-proof detectors write.
 *
 * A DEDICATED anchor rather than the blog change this run came from, for two
 * reasons that both bite: `signals.changeId` is unique, so hanging a second signal
 * off the blog change would silently lose one of the two (the lexical classifier
 * owns that change); and the blog monitor's snapshot chain is what content-hash
 * dedup diffs the next capture against.
 *
 * R2 before DB — `snapshots.r2Key` is NOT NULL, and the body IS the evidence the
 * insight gets grounded on.
 */
async function writeEditorialChange(
  competitor: CompetitorRow,
  blogSnapshotId: string,
  hashKey: string,
  diffText: string,
  rawDiff: Record<string, unknown>,
): Promise<string | null> {
  let monitor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.competitorId, competitor.id),
      eq(monitors.sourceType, "editorial_shift"),
    ),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId: competitor.id,
        sourceType: "editorial_shift",
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error("Failed to ensure editorial_shift monitor");

  const contentHash = computeHash(hashKey);
  const [seen] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(snapshots)
    .where(and(eq(snapshots.monitorId, monitor.id), eq(snapshots.contentHash, contentHash)));
  if ((seen?.n ?? 0) > 0) return null;

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  const now = new Date();
  const r2Key = `snapshots/${competitor.id}/editorial_shift/${now.toISOString()}`;
  await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

  const [snapshot] = await db
    .insert(snapshots)
    .values({
      monitorId: monitor.id,
      r2Key,
      contentHash,
      status: "success",
      scrapedAt: now,
      resolvedUrl: competitor.url ?? null,
    })
    .returning();
  if (!snapshot) throw new Error("Failed to insert editorial_shift snapshot");

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: monitor.id,
      // The blog capture that triggered the read is the "after" side, so the
      // signal's evidence points at a real page, the same shape emitNamedYou uses.
      snapshotBeforeId: prevSnapshot?.id ?? null,
      snapshotAfterId: snapshot.id,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: { ...rawDiff, blogSnapshotId },
      detectedAt: now,
    })
    .returning();
  if (!change) throw new Error("Failed to insert editorial_shift change");
  return change.id;
}
