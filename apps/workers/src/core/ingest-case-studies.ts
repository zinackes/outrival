import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, generateSignal } from "@outrival/queue";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  caseStudies,
  changes,
  competitors,
  contentItems,
  knownCustomers,
  monitors,
  products,
  snapshots,
} from "@outrival/db";
import { resolveUserIndustry, industryLabel, normalizeCustomerName, displayCustomerName } from "@outrival/shared";
import { extractCaseStudies, AI_CONFIG } from "@outrival/ai";
import {
  applyCaseStudyGuards,
  findCaseStudyLinks,
  isCustomerIndexUrl,
  looksLikeCustomersIndex,
  parseCustomerLogos,
  planCustomersRun,
  extractArticleText,
  CUSTOMER_INDEX_PATHS,
  type CustomerNameHit,
} from "@outrival/scrapers/content";
import { fetchPostHtml } from "@outrival/scrapers/content-fetch";
import { loggedAi } from "../lib/analytics";

/**
 * Read who a competitor is winning (Content Intelligence v2 P3).
 *
 * The homepage logo wall told us how many logos a competitor has. It could not tell
 * us WHO, in WHICH market, or what result they were willing to print — which is the
 * whole of what a sales team asks when a rival publishes a customer story. This job
 * reads the two surfaces that carry that: the /customers index, and the individual
 * case studies it links to.
 *
 * Four rules bound it, and each is a rule rather than a tuning knob:
 *
 *  - THE FIRST PASS IS A BASELINE. A customers page lists every customer the
 *    company has ever had, so the first read would announce fifteen "wins" the day
 *    a competitor is added, all of them years old. The rows and the registry are
 *    written — that memory is the entire point — and nothing signals.
 *  - THE REGISTRY IS THE DEDUP. `known_customers` is unique per (competitor, name),
 *    so a customer announced on the blog, then linked from the index, then still
 *    listed next quarter is ONE win, for good. Nothing is ever recorded on a
 *    customer DISAPPEARING: logo walls rotate and paginate, so a churn signal built
 *    on absence would be wrong most of the time (locked decision).
 *  - THE MODEL PROPOSES, CODE DECIDES. `applyCaseStudyGuards` re-checks the
 *    customer name and every claimed metric against the fetched page.
 *  - HIGH NEEDS TWO CANONICAL SLUGS. A case study is raised to `high` only when the
 *    reader's own market resolves to a catalog slug AND the story's does AND they
 *    match. A guessed match would page somebody about a market they are not in.
 */

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  urls: z.array(z.string()).optional(),
  contentItemIds: z.array(z.string()).optional(),
});

/** Pages fetched per run, index included. The rest wait for the next capture. */
const MAX_PAGES_PER_RUN = 10;
/** Stories sent to the model in one call. Half the blog's: case studies are long. */
const BATCH_SIZE = 5;
/** Customers named in one grouped win signal before it starts counting instead. */
const MAX_NAMED_WINS = 5;

export async function runIngestCaseStudies(payload: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(payload);
  logger.log("Starting ingest-case-studies", {
    competitorId: input.competitorId,
    urls: input.urls?.length ?? 0,
    items: input.contentItemIds?.length ?? 0,
  });

  const competitor = await db.query.competitors.findFirst({
    where: eq(competitors.id, input.competitorId),
  });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);
  if (competitor.deletedAt) return { skipped: true, reason: "deleted" };

  const snapshot = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, input.snapshotId),
  });
  if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);
  // A backdated archive capture shows a customers page as it stood months ago. No
  // signal ever comes off a backfill, and the rows would be dated wrong.
  if (snapshot.origin === "archive") return { skipped: true, reason: "archive" };

  // How much customer proof we already hold decides whether this run can signal at
  // all. Counted before anything is written, so the baseline pass sees zero.
  //
  // BOTH tables count. Naming customers is not the only thing a customers surface
  // does: a competitor whose stories are all anonymised ("a leading European bank")
  // would keep an empty registry forever, so a registry-only count would make every
  // run its first run and the feature would be permanently silent.
  const [held] = await db
    .select({
      n: sql<number>`(select count(*) from ${knownCustomers} where ${knownCustomers.competitorId} = ${competitor.id})
        + (select count(*) from ${caseStudies} where ${caseStudies.competitorId} = ${competitor.id})`,
    })
    .from(competitors)
    .where(eq(competitors.id, competitor.id));
  const plan = planCustomersRun({ heldRows: Number(held?.n ?? 0) });

  // The index is re-read on a sitemap run (its weekly cadence is what keeps the
  // logo wall fresh) and on the very first pass, whatever triggered it. A blog run
  // that already knows which page to read never pays for it.
  const triggerSource = await sourceTypeOf(snapshot.monitorId);
  const indexPass = triggerSource === "sitemap" || plan.mode === "baseline";

  const pages: PageTarget[] = [];
  let budget = MAX_PAGES_PER_RUN;

  // ── The customers index ─────────────────────────────────────────────────────
  let discoveredLinks: string[] = [];
  if (indexPass && budget > 0) {
    const indexUrl = await resolveIndexUrl(competitor);
    if (indexUrl) {
      budget--;
      const fetched = await fetchPostHtml(indexUrl);
      if (fetched.ok) {
        const logos = parseCustomerLogos(fetched.html);
        const written = await recordCustomers(competitor.id, logos, "customers_page", indexUrl);
        logger.log("Customers index read", {
          competitorId: competitor.id,
          indexUrl,
          logos: logos.length,
          newNames: written.length,
        });
        discoveredLinks = findCaseStudyLinks(fetched.html, indexUrl);
        if (plan.mode === "read" && !competitorIsSelf(competitor)) {
          await emitCustomerWin({
            competitor,
            snapshotId: snapshot.id,
            names: written,
            evidenceUrl: indexUrl,
          });
        }
      } else {
        logger.log("Customers index unreadable", {
          competitorId: competitor.id,
          indexUrl,
          reason: fetched.reason,
        });
      }
    }
  }

  // ── The stories ─────────────────────────────────────────────────────────────
  const fromItems = await urlsOfItems(input.contentItemIds ?? []);
  const candidates = dedupe([
    ...(input.urls ?? []),
    ...fromItems.map((i) => i.url),
    ...discoveredLinks,
  ]).filter((u) => !isCustomerIndexUrl(u));
  const unread = await filterAlreadyStored(competitor.id, candidates);
  const itemIdByUrl = new Map(fromItems.map((i) => [i.url, i.id]));

  for (const url of unread.slice(0, Math.max(0, budget))) {
    pages.push({ url, contentItemId: itemIdByUrl.get(url) ?? null });
  }
  if (unread.length > budget) {
    // Never silent: what a cap dropped is a fact about this run, and the pages are
    // still unread rows next time — nothing is lost, only deferred.
    logger.log("Case-study pages deferred to the next run", {
      competitorId: competitor.id,
      deferred: unread.length - Math.max(0, budget),
    });
  }

  if (pages.length === 0) {
    logger.log("Completed ingest-case-studies — nothing new to read", {
      competitorId: competitor.id,
      baseline: plan.mode === "baseline",
    });
    return { pages: 0, stored: 0, emitted: 0, baseline: plan.mode === "baseline" };
  }

  const fetched: Array<PageTarget & { title: string; text: string }> = [];
  for (const page of pages) {
    const result = await fetchPostHtml(page.url);
    if (!result.ok) {
      logger.log("Case study unreadable", { url: page.url, reason: result.reason });
      continue;
    }
    const text = extractArticleText(result.html);
    if (!text.trim()) continue;
    fetched.push({ ...page, title: titleOf(result.html) ?? page.url, text });
  }

  const stored: StoredStudy[] = [];
  for (let i = 0; i < fetched.length; i += BATCH_SIZE) {
    const batch = fetched.slice(i, i + BATCH_SIZE);
    const result = await loggedAi(
      "extract_case_studies",
      AI_CONFIG.classification,
      () => extractCaseStudies(batch.map((p) => ({ title: p.title, text: p.text }))),
      { competitorId: competitor.id },
    );
    if (!result) {
      // A parse miss loses this batch, not the run. The pages stay unstored and the
      // next capture that lists them tries again.
      logger.warn("Case study extraction batch returned nothing", {
        competitorId: competitor.id,
        batch: batch.length,
      });
      continue;
    }

    for (const entry of result.studies) {
      const page = batch[entry.index];
      if (!page) continue; // an index the model invented
      const guarded = applyCaseStudyGuards(page.text, {
        customerName: entry.customer_name,
        customerIndustryLabel: entry.customer_industry_label,
        useCase: entry.use_case,
        metricsClaimed: entry.metrics_claimed,
      });

      const [row] = await db
        .insert(caseStudies)
        .values({
          competitorId: competitor.id,
          contentItemId: page.contentItemId,
          url: page.url,
          title: page.title,
          customerName: guarded.customerName,
          customerIndustry: guarded.industrySlug,
          customerIndustryLabel: guarded.industryLabel,
          isCanonicalIndustry: guarded.isCanonicalIndustry ? 1 : 0,
          useCase: guarded.useCase,
          metricsClaimed: guarded.metricsClaimed,
        })
        .onConflictDoNothing()
        .returning({ id: caseStudies.id });
      if (!row) continue; // already stored — a page linked from two places

      // The customer enters the registry, but a story does NOT also emit a win: the
      // case study signal names them and carries the market and the numbers, so a
      // second alert about the same company would be the same news, twice.
      if (guarded.customerName) {
        await recordCustomers(
          competitor.id,
          [
            {
              displayName: displayCustomerName(guarded.customerName),
              nameNormalized: normalizeCustomerName(guarded.customerName),
            },
          ],
          "case_study",
          page.url,
        );
      }

      stored.push({
        id: row.id,
        url: page.url,
        title: page.title,
        customerName: guarded.customerName,
        industrySlug: guarded.industrySlug,
        industryLabel: guarded.industryLabel,
        isCanonicalIndustry: guarded.isCanonicalIndustry,
        metrics: guarded.metricsClaimed,
      });
    }
  }

  // ── Signals ─────────────────────────────────────────────────────────────────
  let emitted = 0;
  if (plan.mode === "read" && !competitorIsSelf(competitor) && stored.length > 0) {
    const userIndustry = await resolveWorkspaceIndustry(competitor.orgId);
    for (const study of stored) {
      const ok = await emitCaseStudyPublished({
        competitor,
        snapshotId: snapshot.id,
        study,
        userIndustry,
      });
      if (ok) emitted++;
    }
  }

  logger.log("Completed ingest-case-studies", {
    competitorId: competitor.id,
    pages: fetched.length,
    stored: stored.length,
    emitted,
    baseline: plan.mode === "baseline",
  });
  return { pages: fetched.length, stored: stored.length, emitted, baseline: plan.mode === "baseline" };
}

type CompetitorRow = typeof competitors.$inferSelect;

interface PageTarget {
  url: string;
  contentItemId: string | null;
}

interface StoredStudy {
  id: string;
  url: string;
  title: string;
  customerName: string | null;
  industrySlug: string | null;
  industryLabel: string | null;
  isCanonicalIndustry: boolean;
  metrics: string[];
}

function competitorIsSelf(competitor: CompetitorRow): boolean {
  return competitor.type === "self";
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls.filter((u) => typeof u === "string" && u.trim())));
}

/** The `<title>` of a fetched page, trimmed of the site-name suffix most templates
 *  append. Null when the document has none. */
function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);
  const raw = m?.[1]?.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw.split(/\s+[|·—–]\s+/)[0]?.trim() || raw;
}

async function sourceTypeOf(monitorId: string): Promise<string | null> {
  const [row] = await db
    .select({ sourceType: monitors.sourceType })
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .limit(1);
  return row?.sourceType ?? null;
}

async function urlsOfItems(ids: string[]): Promise<Array<{ id: string; url: string }>> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: contentItems.id, url: contentItems.url })
    .from(contentItems)
    .where(inArray(contentItems.id, ids));
  return rows.flatMap((r) => (r.url ? [{ id: r.id, url: r.url }] : []));
}

/** Drop the pages we already hold a story for — the index links the same case
 *  studies every week, and re-fetching them would be a weekly cost for no fact. */
async function filterAlreadyStored(competitorId: string, urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const rows = await db
    .select({ url: caseStudies.url })
    .from(caseStudies)
    .where(and(eq(caseStudies.competitorId, competitorId), inArray(caseStudies.url, urls)));
  const known = new Set(rows.map((r) => r.url));
  return urls.filter((u) => !known.has(u));
}

/**
 * Where this competitor's customers index lives.
 *
 * Probed ONCE, then cached on `competitors.metadata`. A probe is a handful of GETs
 * against someone else's site, and the answer does not change — a company that put
 * its customers at /customers does not move them. The merge is done in SQL so a
 * concurrent write of a sibling key (mobile apps, ambiguousName) is not clobbered.
 */
async function resolveIndexUrl(competitor: CompetitorRow): Promise<string | null> {
  const meta = (competitor.metadata ?? {}) as Record<string, unknown>;
  const cached = typeof meta.customersUrl === "string" ? meta.customersUrl : null;
  if (cached) return cached;
  // A cached MISS is a fact too: without it, a competitor with no customers page
  // would pay the full probe on every sitemap run, forever.
  if (meta.customersUrl === null) return null;
  if (!competitor.url) return null;

  let origin: string;
  try {
    origin = new URL(competitor.url).origin;
  } catch {
    return null;
  }

  let found: string | null = null;
  for (const path of CUSTOMER_INDEX_PATHS) {
    const candidate = `${origin}${path}`;
    const result = await fetchPostHtml(candidate);
    if (!result.ok) continue;
    // A site that serves its homepage for every unknown path answers 200 with a
    // page full of customer logos, which is exactly what we came for — so the page
    // has to NAME itself as the customers index, not merely carry logos.
    if (!looksLikeCustomersIndex(result.html, candidate)) continue;
    found = candidate;
    break;
  }

  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify({
        customersUrl: found,
      })}::jsonb`,
    })
    .where(eq(competitors.id, competitor.id));
  return found;
}

/**
 * Put names into the registry and report which ones were NEW.
 *
 * The unique index does the work: an insert that conflicts returns nothing, so the
 * rows this returns are exactly the customers we had never seen this competitor
 * claim. That set IS the win — there is no separate "is this new" question to get
 * wrong.
 */
async function recordCustomers(
  competitorId: string,
  hits: ReadonlyArray<CustomerNameHit>,
  source: "case_study" | "customers_page",
  evidenceUrl: string,
): Promise<Array<{ displayName: string; firstSeenAt: Date }>> {
  const values = hits
    .filter((h) => h.nameNormalized)
    .map((h) => ({
      competitorId,
      nameNormalized: h.nameNormalized,
      displayName: h.displayName,
      source,
      evidenceUrl,
    }));
  if (values.length === 0) return [];
  return await db
    .insert(knownCustomers)
    .values(values)
    .onConflictDoNothing()
    .returning({
      displayName: knownCustomers.displayName,
      firstSeenAt: knownCustomers.firstSeenAt,
    });
}

/**
 * Which market this workspace sells into, or null when its profile names none.
 *
 * Null is the common answer and it is load-bearing: it makes the HIGH severity
 * impossible rather than approximate. Read from the products' self-competitor
 * profiles first (per-SKU, auto-refreshed from the homepage on every scrape) and
 * only then from the org's legacy profile.
 */
async function resolveWorkspaceIndustry(orgId: string): Promise<string | null> {
  const rows = await db
    .select({ selfProfile: competitors.selfProfile })
    .from(products)
    .innerJoin(competitors, eq(products.selfCompetitorId, competitors.id))
    .where(eq(products.orgId, orgId));

  for (const row of rows) {
    const profile = (row.selfProfile ?? {}) as {
      audience?: { value?: string | null } | null;
      category?: { value?: string | null } | null;
    };
    const slug = resolveUserIndustry({
      audience: profile.audience?.value ?? null,
      category: profile.category?.value ?? null,
    });
    if (slug) return slug;
  }
  return null;
}

/**
 * The per-competitor `customer_proof` anchor: isActive=false, never scheduled,
 * never scraped. It exists to carry the change → signal FK chain and to give these
 * signals their own source type, off the sitemap and blog chains whose snapshots
 * are what the next capture's content-hash dedup diffs against.
 */
async function ensureAnchor(competitorId: string) {
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "customer_proof")),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(monitors)
    .values({
      competitorId,
      sourceType: "customer_proof",
      frequency: "weekly", // unused — this monitor is never scheduled
      isActive: false,
      config: {},
    })
    .returning();
  if (!created) throw new Error("Failed to ensure customer_proof monitor");
  return created;
}

/**
 * `case_study_published`: a competitor put a customer's story in print.
 *
 * HIGH only when both markets resolve to a CATALOG slug and those slugs match —
 * that is a rival proving, publicly, that they win in the reader's own vertical.
 * Everything else is medium, including a story whose market the catalog does not
 * know: a free-text slug is that page's own wording, so a match on it would mean
 * nothing but that two pages used the same phrase.
 */
async function emitCaseStudyPublished(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  study: StoredStudy;
  userIndustry: string | null;
}): Promise<boolean> {
  const { competitor, study, userIndustry } = args;
  const anchor = await ensureAnchor(competitor.id);

  const sameMarket =
    study.isCanonicalIndustry && userIndustry !== null && study.industrySlug === userIndustry;
  const severity = sameMarket ? ("high" as const) : ("medium" as const);

  const who = study.customerName ?? "an unnamed customer";
  const market = study.industrySlug ? industryLabel(study.industrySlug) : null;
  const headline = market ? `${who} (${market})` : who;
  const metric = study.metrics[0] ? ` — "${study.metrics[0]}"` : "";

  const diffText =
    `${competitor.name} published a customer story about ${headline}${metric}\n` +
    `${study.title} — ${study.url}\n\n` +
    (study.metrics.length > 0
      ? `Results the page claims, in its own words:\n${study.metrics.map((m) => `- "${m}"`).join("\n")}\n\n`
      : "") +
    (sameMarket
      ? `This customer is in YOUR market: a competitor is proving in public that they win here.`
      : `A published customer story is the reference their sales team will send to the next prospect.`);

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      // The capture that led us here IS the evidence, so it is the "after" side —
      // the same shape competitor_named_you uses on its own anchor.
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "case_study_published",
        caseStudyId: study.id,
        url: study.url,
        customerName: study.customerName,
        industry: study.industrySlug,
        sameMarket,
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      category: "content" as const,
      severity,
      is_significant: true,
      reason: `${competitor.name} published a customer story about ${headline}`,
      humanChangeBefore: null,
      humanChangeAfter: `New case study — ${headline}${metric}`,
    },
  });

  await db.update(monitors).set({ lastChangedAt: new Date() }).where(eq(monitors.id, anchor.id));
  return true;
}

/**
 * `customer_win`: names on the customers page we have never seen there before.
 *
 * ONE grouped signal per run, not one per name: a competitor that refreshes its
 * wall adds four logos at once, and four alerts about the same page refresh is the
 * same news four times. `partnerships` is the closest existing category — a named
 * commercial relationship — and the taxonomy is deliberately not extended for it.
 */
async function emitCustomerWin(args: {
  competitor: CompetitorRow;
  snapshotId: string;
  names: Array<{ displayName: string; firstSeenAt: Date }>;
  evidenceUrl: string;
}): Promise<boolean> {
  const { competitor, names, evidenceUrl } = args;
  if (names.length === 0) return false;

  const anchor = await ensureAnchor(competitor.id);
  const shown = names.slice(0, MAX_NAMED_WINS).map((n) => n.displayName);
  const rest = names.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
  const headline =
    names.length === 1
      ? `New customer — ${shown[0]}`
      : `${names.length} new customers — ${list}`;

  const diffText =
    `${competitor.name} now lists ${names.length === 1 ? "a customer" : `${names.length} customers`} we had never seen them claim: ${list}\n` +
    `Seen on ${evidenceUrl}\n\n` +
    `A logo added to a customers page is a deal they closed and chose to make public. ` +
    `Names are only ever added here, never removed: walls rotate and paginate, so a ` +
    `name disappearing says nothing about the relationship.`;

  const [change] = await db
    .insert(changes)
    .values({
      monitorId: anchor.id,
      snapshotAfterId: args.snapshotId,
      diffText: diffText.slice(0, 50000),
      diffType: "text",
      rawDiff: {
        kind: "customer_win",
        names: names.map((n) => n.displayName),
        evidenceUrl,
      },
      detectedAt: new Date(),
    })
    .returning();
  if (!change) return false;

  await generateSignal.enqueue({
    changeId: change.id,
    classification: {
      category: "partnerships" as const,
      severity: "medium" as const,
      is_significant: true,
      reason: `${competitor.name} added ${names.length} customer${names.length === 1 ? "" : "s"} to its customers page: ${list}`,
      humanChangeBefore: null,
      humanChangeAfter: headline,
    },
  });

  await db.update(monitors).set({ lastChangedAt: new Date() }).where(eq(monitors.id, anchor.id));
  return true;
}
