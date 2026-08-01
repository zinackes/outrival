import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  competitors,
  contentItems,
  changes,
  monitors,
  organizations,
  snapshots,
} from "@outrival/db";
import { getFromR2 } from "@outrival/shared";
import { enrichBlogPosts, AI_CONFIG } from "@outrival/ai";
import {
  parseBlogItems,
  applyBlogGuards,
  planBlogRun,
  resolveSelfMatch,
  hostOf,
  type ContentItemInput,
  type KeptMention,
  type SelfIdentity,
} from "@outrival/scrapers/content";
import { fetchPostTexts, POST_FETCH_CAP, POST_FETCH_MAX_ATTEMPTS } from "@outrival/scrapers/content-fetch";
import { loggedAi } from "../lib/analytics";

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
    logger.log("Completed ingest-blog-posts — nothing new to read", {
      competitorId: competitor.id,
      inserted,
    });
    return { parsed: parsed.length, inserted, fetched: 0, enriched: 0, emitted: 0 };
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
  const self: SelfIdentity | null =
    competitor.type === "self" ? null : await resolveSelfIdentity(competitor.orgId);
  const named: Array<{ id: string; url: string; title: string; snippet: string }> = [];
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
        competitorsNamed: entry.competitors_named.map((m) => ({
          name: m.name,
          snippet: m.snippet ?? null,
        })),
        summary: entry.summary,
      });

      // Which of the named competitors is the reader themselves. Decided here, so
      // the sentence stored as the row's quote is the one about them: a post that
      // names three rivals would otherwise file the first mention's sentence, and
      // the alert would show the reader a quote about somebody else.
      const mine: KeptMention | undefined = self
        ? guarded.mentions.find(
            (m) => resolveSelfMatch({ mention: m.name, postText: post.text, self }) !== null,
          )
        : undefined;

      await db
        .update(contentItems)
        .set({
          itemType: guarded.itemType,
          topics: guarded.topics,
          products: guarded.products,
          personas: guarded.personas,
          competitorsNamed: guarded.mentions.slice(0, MAX_MENTIONS_PER_POST).map((m) => m.name),
          summary: guarded.summary,
          // The publisher's words or nothing, substring-verified above.
          evidenceSnippet: mine?.snippet ?? guarded.mentions[0]?.snippet ?? null,
          enrichedAt: new Date(),
        })
        .where(eq(contentItems.id, post.id));

      enrichedCount++;
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

  // ── Signal ──────────────────────────────────────────────────────────────────
  let emitted = 0;
  for (const post of named) {
    const ok = await emitNamedYou({ competitor, snapshotId: snapshot.id, ...post, itemId: post.id });
    if (ok) emitted++;
  }

  logger.log("Completed ingest-blog-posts", {
    competitorId: competitor.id,
    inserted,
    fetched: fetched.length,
    enriched: enrichedCount,
    emitted,
  });
  return {
    parsed: parsed.length,
    inserted,
    fetched: fetched.length,
    enriched: enrichedCount,
    emitted,
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
 * `markSeen` is the baseline: `enrichedAt` is stamped so those rows leave the fetch
 * queue permanently. They are not "read and found empty" — they are the state the
 * blog was in when we arrived, and the point of a baseline is that everything after
 * it is genuinely new.
 */
async function insertItems(
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
    .onConflictDoNothing()
    .returning({ id: contentItems.id });
  return rows.length;
}

/**
 * Who this workspace is, as a competitor's post could refer to it: the names it
 * goes by and the domains it owns. Multi-SKU workspaces carry one self-competitor
 * per product, so all of them count — a post naming the second SKU is naming the
 * user just as much as one naming the first.
 */
async function resolveSelfIdentity(orgId: string): Promise<SelfIdentity> {
  const [org, selves] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true, productUrl: true },
    }),
    db
      .select({ name: competitors.name, url: competitors.url })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          eq(competitors.type, "self"),
          isNull(competitors.deletedAt),
        ),
      ),
  ]);

  const brands = [org?.name, ...selves.map((s) => s.name)].filter(
    (b): b is string => Boolean(b?.trim()),
  );
  const domains = [org?.productUrl, ...selves.map((s) => s.url)]
    .map((u) => hostOf(u))
    .filter((d): d is string => Boolean(d));
  return { brands, domains };
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
