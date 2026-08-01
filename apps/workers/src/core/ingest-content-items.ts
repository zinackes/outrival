import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, classifyChange, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  competitors,
  contentItems,
  monitors,
  snapshots,
  changes,
  roadmapStatusEvents,
} from "@outrival/db";
import {
  computeHash,
  getFromR2,
  uploadToR2,
  resolveRoadmapStatus,
  type RoadmapStatus,
} from "@outrival/shared";
import { typeContentItems, AI_CONFIG } from "@outrival/ai";
import {
  parseChangelogItems,
  parseRoadmapItems,
  typeChangelogEntry,
  buildMonthSeries,
  detectShippingVelocityShift,
  previousMonthKey,
  isChangelogItemType,
  planTopRequestSignal,
  TOP_REQUEST_COOLDOWN_DAYS,
  type ContentItemInput,
  type RoadmapEntryState,
  type RoadmapMove,
} from "@outrival/scrapers/content";
import { isVerbatim } from "@outrival/scrapers/jobs-jd-facts";
import { loggedAi } from "../lib/analytics";

/**
 * Turn a captured changelog or roadmap into ROWS (Content Intelligence v2 P1).
 *
 * Event-triggered off scrape-monitor per capture — never a cron, never on the
 * archive backfill (which only replays homepage/pricing anyway). It writes
 * `content_items` IN ADDITION to the snapshot → diff → classify path that already
 * runs, and then reads those rows back for the two things a diff could never say:
 *
 *  - breaking_change / deprecation — DETERMINISTIC. The entry type comes from the
 *    keyword pass in @outrival/scrapers/content, not from a model, so the loudest
 *    signal this feature emits cannot be hallucinated. It rides the changelog's
 *    OWN change row (scrape-monitor defers the classify for exactly this), so the
 *    reader gets one signal about the release rather than two.
 *  - shipping_velocity_shift — how their release cadence moved against its own
 *    trailing months, on the dedicated `shipping_velocity` anchor.
 *  - top_request_planned (P5) — one of the portal's most-voted open requests moved
 *    into committed work. Deterministic too: the rank and the floors are arithmetic
 *    over vote counts the portal itself publishes.
 *
 * The AI half is one batched call per ~10 untyped entries and separates feature
 * from improvement. Nothing it returns can raise an alert, and the roadmap half
 * spends none of it: a portal serves structured entries with their own statuses.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  sourceType: z.enum(["changelog", "roadmap"]),
  /** The change row of the SAME capture, whose signal routing scrape-monitor
   * DEFERRED here: a deterministic entry type owns it, else it goes back to the
   * lexical classifier. Absent when the capture produced no change row. */
  changeId: z.string().optional(),
  /** Whether that change passed evaluateSignificance — i.e. worth a lexical
   * classify when no deterministic type turns up. */
  lexicalWorth: z.boolean().optional().default(false),
});

/** Entries sent to the model in one call. */
const BATCH_SIZE = 10;
/** Ceiling per run. A fresh 100-entry feed finishes over three runs, never in one bill. */
const MAX_TYPED_PER_RUN = 40;
/** Entries named in one signal. */
const MAX_SIGNALLED = 8;
/** Months of history read for the cadence series. */
const SERIES_MONTHS = 18;
/** Summaries are one line by contract; this is the guard, not the intent. */
const MAX_SUMMARY_CHARS = 300;
/**
 * How recent an entry must be to raise a breaking/deprecation alert. A feed can
 * backfill its own archive, and "they are breaking their API" is a false statement
 * about a change that shipped two years ago and has already been lived with.
 */
const LOUD_ENTRY_MAX_AGE_DAYS = 90;

export async function runIngestContentItems(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-content-items", input);

  // A deferred change must never be stranded: every path that ends without a
  // deterministic emission hands it back to the lexical classifier (iff
  // scrape-monitor judged the diff worth one) — the exact pre-P1 behaviour.
  const enqueueLexicalFallback = async () => {
    if (input.changeId && input.lexicalWorth) {
      await classifyChange.enqueue({ changeId: input.changeId });
    }
  };

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  if (competitor.deletedAt) {
    await enqueueLexicalFallback();
    return { skipped: true, reason: "deleted" };
  }

  const snapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, input.snapshotId),
  });
  if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);
  // An archived capture is backdated history read years late. No signal may come
  // off a backfill, and its entries would date-stamp rows nobody published today.
  if (snapshot.origin === "archive") {
    await enqueueLexicalFallback();
    return { skipped: true, reason: "archive" };
  }

  const html = await getFromR2(`${snapshot.r2Key}.html`);
  const parsed =
    input.sourceType === "changelog" ? parseChangelogItems(html) : parseRoadmapItems(html);

  if (parsed.length === 0) {
    // A changelog with no feed falls back to plain HTML change-detection, which
    // carries no entries to read. That is the pre-existing path, not a failure.
    logger.log("No structured content items in this capture", {
      competitorId: input.competitorId,
      sourceType: input.sourceType,
    });
    await enqueueLexicalFallback();
    return { parsed: 0, inserted: 0, typed: 0, emitted: 0 };
  }

  if (input.sourceType === "roadmap") {
    const roadmap = await ingestRoadmap(competitor, parsed, input.changeId ?? null);
    // Nothing deterministic came out of the portal move, so the change goes back to
    // the lexical classifier exactly as it did before P5 deferred it.
    if (!roadmap.emitted) await enqueueLexicalFallback();
    logger.log("Completed ingest-content-items (roadmap)", {
      competitorId: input.competitorId,
      parsed: parsed.length,
      moves: roadmap.moves,
      baseline: roadmap.baseline,
      emitted: roadmap.emitted,
    });
    return {
      parsed: parsed.length,
      inserted: roadmap.inserted,
      typed: 0,
      emitted: roadmap.emitted ? 1 : 0,
      baseline: roadmap.baseline,
    };
  }

  const newIds = await upsertItems(input.competitorId, input.sourceType, parsed);
  logger.log("Ingested content items", {
    competitorId: input.competitorId,
    sourceType: input.sourceType,
    parsed: parsed.length,
    inserted: newIds.length,
  });

  const typed = await typeNewEntries(input.competitorId);

  // Signals are about competitors. "You shipped a breaking change" tells the user
  // what they did — the rule every sibling detector applies. The rows are still
  // written: the cadence read compares their own velocity against the roster.
  if (competitor.type === "self") {
    await enqueueLexicalFallback();
    return { parsed: parsed.length, inserted: newIds.length, typed, emitted: 0, self: true };
  }

  const emittedLoud = input.changeId
    ? await emitBreakingOrDeprecation(competitor, newIds, input.changeId)
    : false;
  if (!emittedLoud) await enqueueLexicalFallback();

  const emittedVelocity = await emitVelocityShift(competitor);

  logger.log("Completed ingest-content-items", {
    competitorId: input.competitorId,
    inserted: newIds.length,
    typed,
    loud: emittedLoud,
    velocity: emittedVelocity,
  });
  return {
    parsed: parsed.length,
    inserted: newIds.length,
    typed,
    emitted: (emittedLoud ? 1 : 0) + (emittedVelocity ? 1 : 0),
  };
}

/** The competitor columns every emitter below needs. */
type CompetitorRow = typeof competitors.$inferSelect;

/**
 * Write what this capture published, and report back the ids of what was NEW.
 *
 * Uniqueness is (competitor, source, external_id), so re-reading the same feed
 * re-inserts nothing and `returning()` names exactly the entries we had not seen.
 * That set is what gets typed and what a signal may be about — an entry already in
 * the table was already news once.
 *
 * Roadmap entries take the other path (`ingestRoadmap`): their STATUS is the fact,
 * so they update in place and the write has to report what MOVED rather than what
 * was new.
 */
async function upsertItems(
  competitorId: string,
  sourceType: "changelog",
  items: ContentItemInput[],
): Promise<string[]> {
  const values = items.map((it) => ({
    competitorId,
    sourceType,
    externalId: it.externalId,
    title: it.title,
    url: it.url,
    publishedAt: it.publishedAt ? new Date(it.publishedAt) : null,
    status: it.status,
    itemType: it.itemType,
  }));

  const rows = await db
    .insert(contentItems)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: contentItems.id });
  return rows.map((r) => r.id);
}

/**
 * The roadmap half of the ingestion (Content Intelligence v2 P5).
 *
 * A portal entry updates IN PLACE — its status is the fact, and planned → shipped
 * is the reason to watch a portal at all — so unlike a feed entry there is no "new
 * rows" set to work from. What matters is what MOVED, which is why every transition
 * is appended to `roadmap_status_events` as it is seen.
 *
 * THE FIRST READ OF A PORTAL IS A BASELINE, the same rule the customers registry
 * follows. A portal we have never read hands us thirty entries, some of which have
 * been "Planned" since 2024; writing those as transitions would announce thirty
 * roadmap moves the day a competitor is added. They are recorded — that memory is
 * the point — with `isBaseline = 1`, and nothing signals.
 */
async function ingestRoadmap(
  competitor: CompetitorRow,
  items: ContentItemInput[],
  changeId: string | null,
): Promise<{ inserted: number; moves: number; baseline: boolean; emitted: boolean }> {
  const held = await db
    .select({
      id: contentItems.id,
      externalId: contentItems.externalId,
      status: contentItems.status,
      statusNormalized: contentItems.statusNormalized,
    })
    .from(contentItems)
    .where(
      and(eq(contentItems.competitorId, competitor.id), eq(contentItems.sourceType, "roadmap")),
    );
  const baseline = held.length === 0;
  const previous = new Map(held.map((r) => [r.externalId, r]));

  const rows = await db
    .insert(contentItems)
    .values(
      items.map((it) => ({
        competitorId: competitor.id,
        sourceType: "roadmap" as const,
        externalId: it.externalId,
        title: it.title,
        url: it.url,
        publishedAt: null,
        status: it.status,
        statusNormalized: resolveRoadmapStatus(it.status),
        votes: it.votes ?? null,
        itemType: it.itemType,
      })),
    )
    .onConflictDoUpdate({
      target: [contentItems.competitorId, contentItems.sourceType, contentItems.externalId],
      set: {
        title: sql`excluded.title`,
        url: sql`excluded.url`,
        status: sql`excluded.status`,
        statusNormalized: sql`excluded.status_normalized`,
        // The weekly capture refreshes the count of every entry it still lists. An
        // entry the portal dropped keeps the last count we saw, which is the last
        // thing that was true about it — we have no evidence it went to zero.
        votes: sql`excluded.votes`,
      },
    })
    .returning({ id: contentItems.id, externalId: contentItems.externalId });

  const idByExternal = new Map(rows.map((r) => [r.externalId, r.id]));

  // ── What moved ──────────────────────────────────────────────────────────────
  const moves: RoadmapMove[] = [];
  const eventValues: Array<typeof roadmapStatusEvents.$inferInsert> = [];
  for (const item of items) {
    const itemId = idByExternal.get(item.externalId);
    if (!itemId) continue;
    const before = previous.get(item.externalId);
    const toStatus = resolveRoadmapStatus(item.status);
    const fromStatus = (before?.statusNormalized ?? null) as RoadmapStatus | null;
    // Nothing moved. An entry whose LABEL was reworded but whose meaning did not
    // change ("Planned" → "Planned (Q3)") is not a roadmap move, and recording it
    // would put a competitor's copy edit in front of the reader as a commitment.
    if (before && fromStatus === toStatus) continue;

    eventValues.push({
      contentItemId: itemId,
      competitorId: competitor.id,
      fromStatus,
      toStatus,
      fromRaw: before?.status ?? null,
      toRaw: item.status ?? toStatus,
      isBaseline: baseline ? 1 : 0,
    });
    if (!baseline) {
      moves.push({
        itemId,
        fromStatus,
        toStatus,
        fromRaw: before?.status ?? null,
        toRaw: item.status ?? toStatus,
      });
    }
  }

  const events =
    eventValues.length > 0
      ? await db
          .insert(roadmapStatusEvents)
          .values(eventValues)
          .returning({ id: roadmapStatusEvents.id, contentItemId: roadmapStatusEvents.contentItemId })
      : [];

  logger.log("Ingested roadmap entries", {
    competitorId: competitor.id,
    entries: items.length,
    events: events.length,
    baseline,
  });

  // A baseline never signals, and neither does our own product: "your most
  // requested feature is now planned" is news the user wrote themselves.
  if (baseline || competitor.type === "self" || moves.length === 0) {
    return { inserted: rows.length, moves: moves.length, baseline, emitted: false };
  }

  const emitted = await emitTopRequestPlanned({
    competitor,
    changeId,
    moves,
    entries: items.flatMap((it) => {
      const itemId = idByExternal.get(it.externalId);
      if (!itemId) return [];
      return [
        {
          itemId,
          title: it.title,
          url: it.url,
          votes: it.votes ?? null,
          status: resolveRoadmapStatus(it.status),
        },
      ];
    }),
    eventIdByItem: new Map(events.map((e) => [e.contentItemId, e.id])),
  });

  return { inserted: rows.length, moves: moves.length, baseline, emitted };
}

/**
 * `top_request_planned`: one of the portal's most-voted open requests just became
 * committed work.
 *
 * Deterministic end to end — the rank and the floors are arithmetic over counts the
 * portal itself publishes, and the text quotes the portal's own status labels rather
 * than our normalised vocabulary, because those are the words their customers read.
 *
 * It rides the roadmap capture's OWN change row when there is one (scrape-monitor
 * defers the classify for exactly this), so the reader gets one signal about the
 * portal rather than two. When the capture produced no change row — a status move
 * the significance gate filtered — it falls back to the synthetic `roadmap_shift`
 * anchor, the same shape the cadence signal uses.
 */
async function emitTopRequestPlanned(args: {
  competitor: CompetitorRow;
  changeId: string | null;
  moves: RoadmapMove[];
  entries: RoadmapEntryState[];
  eventIdByItem: Map<string, string>;
}): Promise<boolean> {
  const { competitor } = args;

  const cutoff = new Date(Date.now() - TOP_REQUEST_COOLDOWN_DAYS * 86_400_000);
  const recent = await db
    .select({ contentItemId: roadmapStatusEvents.contentItemId })
    .from(roadmapStatusEvents)
    .where(
      and(
        eq(roadmapStatusEvents.competitorId, competitor.id),
        gte(roadmapStatusEvents.signalledAt, cutoff),
      ),
    );

  const plan = planTopRequestSignal({
    moves: args.moves,
    entries: args.entries,
    cooledDown: new Set(recent.map((r) => r.contentItemId)),
  });
  if (!plan) return false;

  const { primary, alsoMoved } = plan;
  const statusPhrase = primary.toRaw.toLowerCase();
  const headline = `Top request moves to ${statusPhrase} — "${primary.title}" (${primary.votes} votes, #${primary.rank})`;
  const alsoLines = alsoMoved.map(
    (m) => `- "${m.title}" (${m.votes} votes, #${m.rank}) — ${m.fromRaw ?? "new"} → ${m.toRaw}`,
  );
  const diffText =
    `${competitor.name} moved one of the most requested items on its public roadmap into ` +
    `committed work: "${primary.title}" — ${primary.votes} votes, ranked #${primary.rank} among ` +
    `their open requests — went from ${primary.fromRaw ?? "not listed"} to ${primary.toRaw}.\n` +
    (primary.url ? `${primary.url}\n` : "") +
    (alsoLines.length > 0 ? `\nAlso committed in the same capture:\n${alsoLines.join("\n")}\n` : "") +
    `\nVotes and statuses are the portal's own published numbers and its own column ` +
    `names. A request their customers have been asking for out loud, now taken on, is ` +
    `a gap they are about to close.`;

  let changeId = args.changeId;
  if (!changeId) {
    changeId = await writeAnchoredChange(
      competitor,
      "roadmap_shift",
      `top_request:${primary.itemId}:${primary.toRaw}`,
      diffText,
      {
        kind: "top_request_planned",
        itemId: primary.itemId,
        title: primary.title,
        url: primary.url,
        votes: primary.votes,
        rank: primary.rank,
        fromRaw: primary.fromRaw,
        toRaw: primary.toRaw,
        alsoMoved,
      },
    );
    if (!changeId) return false;
  } else {
    // The roadmap change already exists; its rawDiff is the portal's line diff, so
    // the fact block reads the same shape off a column of its own.
    await db
      .update(changes)
      .set({
        rawDiff: sql`coalesce(${changes.rawDiff}, '{}'::jsonb) || ${JSON.stringify({
          kind: "top_request_planned",
          itemId: primary.itemId,
          title: primary.title,
          url: primary.url,
          votes: primary.votes,
          rank: primary.rank,
          fromRaw: primary.fromRaw,
          toRaw: primary.toRaw,
          alsoMoved,
        })}::jsonb`,
      })
      .where(eq(changes.id, changeId));
  }

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "product" as const,
      severity: primary.severity,
      is_significant: true,
      reason: headline,
      humanChangeBefore: primary.fromRaw ?? "Not on the roadmap",
      humanChangeAfter: `${primary.toRaw} — ${primary.votes} votes (#${primary.rank})`,
    },
  });

  // Stamp every move the signal spoke for, so none of them can fire again inside
  // the cooldown — including the ones named in the body rather than the headline.
  const stamped = [primary, ...alsoMoved]
    .map((m) => args.eventIdByItem.get(m.itemId))
    .filter((id): id is string => Boolean(id));
  if (stamped.length > 0) {
    await db
      .update(roadmapStatusEvents)
      .set({ signalledAt: new Date() })
      .where(inArray(roadmapStatusEvents.id, stamped));
  }

  logger.log("Emitted top_request_planned", {
    competitorId: competitor.id,
    itemId: primary.itemId,
    votes: primary.votes,
    rank: primary.rank,
    severity: primary.severity,
    alsoMoved: alsoMoved.length,
  });
  return true;
}

/**
 * Give every untyped changelog entry a type: keywords first, one batched model
 * call per ten of whatever is left.
 *
 * `enrichedAt` is stamped on every entry sent, including the ones the model
 * returned nothing usable for. Without it a barren entry is indistinguishable
 * from an unread one and goes back to the model on every single run.
 */
async function typeNewEntries(competitorId: string): Promise<number> {
  const pending = await db
    .select({ id: contentItems.id, title: contentItems.title })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.competitorId, competitorId),
        eq(contentItems.sourceType, "changelog"),
        isNull(contentItems.enrichedAt),
      ),
    )
    .orderBy(desc(contentItems.firstSeenAt))
    .limit(MAX_TYPED_PER_RUN);
  if (pending.length === 0) return 0;

  // The keyword pass reads the title, which is what the row stores — a feed body
  // is not persisted, so the loud types are decided on that same text either way.
  const untyped: Array<{ id: string; title: string }> = [];
  for (const row of pending) {
    const itemType = typeChangelogEntry({ title: row.title });
    if (!itemType) {
      untyped.push(row);
      continue;
    }
    await db
      .update(contentItems)
      .set({ itemType, enrichedAt: new Date() })
      .where(eq(contentItems.id, row.id));
  }

  for (let i = 0; i < untyped.length; i += BATCH_SIZE) {
    const batch = untyped.slice(i, i + BATCH_SIZE);
    const result = await loggedAi(
      "type_content_items",
      AI_CONFIG.classification,
      () => typeContentItems(batch.map((b) => ({ title: b.title }))),
      { competitorId },
    );
    if (!result) {
      // A parse miss loses this batch, not the run: the entries stay unenriched
      // and the next capture retries them.
      logger.warn("Content typing batch returned nothing", { competitorId, batch: batch.length });
      continue;
    }
    for (const entry of result.items) {
      const item = batch[entry.index];
      if (!item) continue; // an index the model invented
      const snippet = entry.evidence_snippet?.trim();
      await db
        .update(contentItems)
        .set({
          itemType: isChangelogItemType(entry.item_type) ? entry.item_type : null,
          summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
          // The publisher's words or nothing — the guard posting_facts uses.
          evidenceSnippet: snippet && isVerbatim(snippet, item.title) ? snippet : null,
          enrichedAt: new Date(),
        })
        .where(eq(contentItems.id, item.id));
    }
  }

  // Everything sent is marked, whatever came back.
  await db
    .update(contentItems)
    .set({ enrichedAt: new Date() })
    .where(
      and(
        inArray(
          contentItems.id,
          pending.map((p) => p.id),
        ),
        isNull(contentItems.enrichedAt),
      ),
    );

  return pending.length;
}

/**
 * The signal a release note earns on its own wording: something breaks, or
 * something is going away.
 *
 * Deterministic end to end — the type came from keywords over the entry's own
 * title, and the text below names the entries verbatim with their dates and links.
 * It takes the changelog's OWN change row, which is what keeps the reader from
 * getting this signal AND a lexical one about the same release; a capture with no
 * change row (the first one ever, where the whole archive arrives at once) emits
 * nothing, which is also the right answer for a two-year-old deprecation.
 *
 * Severity is `high` when this workspace watches developer documentation
 * anywhere, `medium` otherwise: a team tracking an API surface is a team whose own
 * product plugs into one, and for them a removed endpoint is dated work rather
 * than a news item.
 */
async function emitBreakingOrDeprecation(
  competitor: CompetitorRow,
  newIds: string[],
  changeId: string,
): Promise<boolean> {
  if (newIds.length === 0) return false;

  const cutoff = new Date(Date.now() - LOUD_ENTRY_MAX_AGE_DAYS * 86_400_000);
  const loud = await db
    .select({
      title: contentItems.title,
      url: contentItems.url,
      publishedAt: contentItems.publishedAt,
      itemType: contentItems.itemType,
    })
    .from(contentItems)
    .where(
      and(
        inArray(contentItems.id, newIds),
        inArray(contentItems.itemType, ["breaking", "deprecation"]),
        // An undated entry is one the feed never dated, not an old one.
        or(isNull(contentItems.publishedAt), gte(contentItems.publishedAt, cutoff)),
      ),
    )
    .orderBy(desc(contentItems.publishedAt))
    .limit(MAX_SIGNALLED);
  if (loud.length === 0) return false;

  const breaking = loud.filter((l) => l.itemType === "breaking");
  const isBreaking = breaking.length > 0;
  const severity = (await orgWatchesDocs(competitor.orgId)) ? "high" : "medium";

  const lines = loud.map((l) => {
    const date = l.publishedAt ? l.publishedAt.toISOString().slice(0, 10) : "undated";
    return `- [${l.itemType}] ${l.title} — ${date}${l.url ? ` — ${l.url}` : ""}`;
  });
  const diffText =
    `${competitor.name} published ${loud.length} ${loud.length === 1 ? "entry" : "entries"} ` +
    `that ${isBreaking ? "break" : "retire"} existing behaviour:\n${lines.join("\n")}\n\n` +
    `Each line is an entry from their own release feed, with the date they published ` +
    `it and a link to it. A breaking change or a deprecation is dated work for anyone ` +
    `built on top of them, which is why it is named rather than summarised.`;

  await generateSignal.enqueue({
    changeId,
    classification: {
      // The developer surface. Emitted only deterministically — the category is
      // absent from the classify prompt, so a model can never reach for it.
      category: "api_developer" as const,
      severity,
      is_significant: true,
      reason: isBreaking
        ? `${competitor.name} shipped a breaking change: ${breaking[0]!.title}`
        : `${competitor.name} deprecated ${loud[0]!.title}`,
      humanChangeBefore: "Supported",
      humanChangeAfter: isBreaking ? "Breaking change published" : "Deprecated",
    },
  });
  return true;
}

/** Does this workspace watch anyone's developer documentation? */
async function orgWatchesDocs(orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(monitors)
    .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
    .where(
      and(
        eq(competitors.orgId, orgId),
        eq(monitors.sourceType, "docs"),
        eq(monitors.isActive, true),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * The cadence signal: releases per month, against this competitor's own trailing
 * months.
 *
 * Evaluated on COMPLETE months only, and never over months that predate the oldest
 * entry we hold — see the detector for why each of those is the difference between
 * a reading and a monthly false alarm.
 */
async function emitVelocityShift(competitor: CompetitorRow): Promise<boolean> {
  const threshold = Number(process.env.SHIPPING_VELOCITY_THRESHOLD ?? 0.5);
  const minBaselineItems = Number(process.env.SHIPPING_VELOCITY_MIN_ITEMS ?? 8);

  const monthExpr = sql<string>`to_char(${contentItems.publishedAt}, 'YYYY-MM')`;
  const dated = and(
    eq(contentItems.competitorId, competitor.id),
    eq(contentItems.sourceType, "changelog"),
    sql`${contentItems.publishedAt} is not null`,
  );

  const [earliest] = await db
    .select({ publishedAt: contentItems.publishedAt })
    .from(contentItems)
    .where(dated)
    .orderBy(asc(contentItems.publishedAt))
    .limit(1);
  if (!earliest?.publishedAt) return false;

  const counts = await db
    .select({ month: monthExpr, count: sql<number>`count(*)::int` })
    .from(contentItems)
    .where(
      and(dated, sql`${contentItems.publishedAt} >= now() - make_interval(months => ${SERIES_MONTHS})`),
    )
    .groupBy(monthExpr);
  if (counts.length === 0) return false;

  const through = previousMonthKey(new Date());
  const from = counts.reduce((min, c) => (c.month < min ? c.month : min), through);
  const shift = detectShippingVelocityShift(
    buildMonthSeries(counts, from, through),
    earliest.publishedAt.toISOString().slice(0, 7),
    { threshold, minBaselineItems },
  );
  if (!shift) return false;

  const baselineLine = shift.baseline.map((b) => `${b.month}: ${b.count}`).join(", ");
  const verb = shift.direction === "accelerating" ? "sped up" : "slowed down";
  const diffText =
    `${competitor.name}'s shipping cadence ${verb}: ${shift.count} published entries in ` +
    `${shift.month} against a ${shift.baseline.length}-month average of ` +
    `${shift.baselineAvg.toFixed(1)} (${baselineLine}).\n\n` +
    `Counted from their own release feed, one row per published entry, over months ` +
    `that have ended. A team that doubles its release rate has just been given people ` +
    `or has just unblocked something; one that stops shipping is usually rebuilding.`;

  const changeId = await writeAnchoredChange(
    competitor,
    "shipping_velocity",
    `velocity:${shift.month}:${shift.direction}`,
    diffText,
    {
      kind: "shipping_velocity_shift",
      month: shift.month,
      count: shift.count,
      baselineAvg: shift.baselineAvg,
      ratio: shift.ratio,
      direction: shift.direction,
      baseline: shift.baseline,
    },
  );
  if (!changeId) return false;

  await generateSignal.enqueue({
    changeId,
    classification: {
      category: "product" as const,
      // A cadence read is an aggregate over a feed, not an announcement. Never
      // critical: that band bypasses every moderation layer and mails the user
      // within minutes, which a monthly count has not earned.
      severity: "medium" as const,
      is_significant: true,
      reason: `${competitor.name} ${verb} to ${shift.count} releases in ${shift.month} (${shift.ratio.toFixed(1)}× its trailing average)`,
      humanChangeBefore: `~${shift.baselineAvg.toFixed(1)} releases/month`,
      humanChangeAfter: `${shift.count} in ${shift.month}`,
    },
  });
  return true;
}

/**
 * Write the synthetic anchor → snapshot → change chain a deterministic signal hangs
 * off, the same shape detect-hiring-velocity-shifts and mine-job-facts use.
 * Returns the change id, or null when this exact event was already emitted (a
 * retried run must not double-signal).
 *
 * The anchor source is a PARAMETER because the two signals in this file must not
 * share a chain: the dedup below counts snapshots on the anchor, so a roadmap move
 * landing between two cadence readings would let a cadence shift re-emit — the same
 * rule the hiring anchors were split under.
 *
 * R2 before DB: `snapshots.r2Key` is NOT NULL, and the body IS the diffText the
 * insight will be grounded on.
 */
async function writeAnchoredChange(
  competitor: CompetitorRow,
  anchorSource: "shipping_velocity" | "roadmap_shift",
  hashKey: string,
  diffText: string,
  rawDiff: Record<string, unknown>,
): Promise<string | null> {
  let monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitor.id), eq(monitors.sourceType, anchorSource)),
  });
  if (!monitor) {
    [monitor] = await db
      .insert(monitors)
      .values({
        competitorId: competitor.id,
        sourceType: anchorSource,
        frequency: "weekly", // unused — this monitor is never scheduled
        isActive: false,
        config: {},
      })
      .returning();
  }
  if (!monitor) throw new Error(`Failed to ensure ${anchorSource} monitor`);

  const prevSnapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, monitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });

  // Dedup against the WHOLE chain, not just the latest snapshot: a cadence that
  // dips and re-crosses months later is news again, but the SAME month in the
  // SAME direction is one piece of news however many captures land in it.
  const contentHash = computeHash(hashKey);
  const [seen] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(snapshots)
    .where(and(eq(snapshots.monitorId, monitor.id), eq(snapshots.contentHash, contentHash)));
  if ((seen?.n ?? 0) > 0) return null;

  const now = new Date();
  const r2Key = `snapshots/${competitor.id}/${anchorSource}/${now.toISOString()}`;
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
  if (!snapshot) throw new Error(`Failed to insert ${anchorSource} snapshot`);

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
  if (!change) throw new Error(`Failed to insert ${anchorSource} change`);
  return change.id;
}
