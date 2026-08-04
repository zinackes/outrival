import { and, desc, eq, gt, gte, inArray, lte, sql as dsql, type SQL } from "drizzle-orm";
import {
  caseStudies,
  changes,
  contentItems,
  jobPostings,
  knownCustomers,
  knownIntegrations,
  messagingVersions,
  namedCompetitors,
  postingFacts,
  techStackEntries,
} from "@outrival/db";
import {
  diffEntitlements,
  diffPriceTiers,
  industryLabel,
  normalizeDepartment,
  DEPARTMENT_BUCKET_LABELS,
  type DepartmentBucket,
  type EntitlementRow,
  type TierBandRow,
} from "@outrival/shared";
import { db } from "./db";
import { analyticsQuery, sql } from "./analytics-safe";

/**
 * The facts a signal is ABOUT, fetched from the rows a sibling extractor wrote.
 *
 * A signal is born from a lexical diff of the page. The structured facts of the
 * same capture (which roles opened, which plan moved from what to what) are
 * written in PARALLEL by extract-jobs / extract-pricing, and the two paths never
 * met: a careers-page signal named five departments and not one role while
 * job_postings held every title, its location, its seniority and its apply URL.
 * This joins them back together at read time.
 *
 * WHY A TIME WINDOW AND NOT A change_id. Stamping the change on the extracted
 * rows is exact, and it was the plan. Two things ruled it out for now. The API
 * already answers this same class of question with a window join over
 * `recorded_at` (routes/activity.ts, the Activity timeline), so a second, private
 * mechanism would be one more thing to keep true. More decisively, a column can
 * only be filled going forward: every signal already in the feed would show
 * nothing until fresh scrapes landed, which is precisely the backlog the reader
 * is complaining about. A window works retroactively on all of them. Revisit if
 * the attribution below ever proves too loose.
 */

/** One role, as it reads on the board. */
export interface RoleFact {
  title: string;
  department: string | null;
  location: string | null;
  seniority: string | null;
  /** The apply link. Present on the structured ATS path, null on the LLM fallback. */
  url: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/** One plan, and what it was at the previous capture. */
export interface PlanFact {
  planName: string;
  billingPeriod: string;
  currency: string | null;
  price: number | null;
  previousPrice: number | null;
  /** Dimensional pricing (Pricing Intelligence P1): what a usage/per-seat price
   * applies to, and the bundled units — so a rate move or a shrunk bundle shows
   * its exact before/after, not just the unchanged headline price. */
  unit: string | null;
  includedQuantity: number | null;
  previousIncludedQuantity: number | null;
  /** added when the plan is new to this capture, removed when it is gone. */
  state: "added" | "removed" | "changed" | "unchanged";
}

/** One packaging move of the capture (P2): the exact before/after of a feature
 * across the plan matrix, derived by the SAME shared differ that emits the
 * signal — the fact block can never disagree with the signal it explains. */
export interface EntitlementFact {
  featureLabel: string;
  state: "moved" | "limit_changed" | "added" | "removed";
  /** Exact human strings ("SSO — Enterprise" → "SSO — Pro";
   * "Starter — 5 seats" → "Starter — 3 seats"). */
  before: string | null;
  after: string | null;
}

/** One volume-ladder move of the capture (P3), derived by the SAME shared
 * differ that emits the signal. A boundary that slid is a price rise with no
 * price change, so the block has to print the bands or the reader sees a
 * pricing signal over numbers that all look identical. */
export interface TierFact {
  planName: string;
  state: "boundary_moved" | "rate_changed";
  /** Exact human strings ("Scale (request) — 0–10k @ $0.10"). */
  before: string | null;
  after: string | null;
}

/** One fact mined out of a job description, with the sentence it came from. */
export interface JobFact {
  /** 'tech' | 'product_hint' | 'team_size' | 'market' | 'language' */
  kind: string;
  value: string;
  /** Verbatim from the JD — substring-verified before it was ever stored. */
  evidenceSnippet: string;
  postingTitle: string;
  /** The posting, so the wording can be read in full. */
  postingUrl: string | null;
}

/** One item a competitor published, as their own feed stated it. */
export interface ContentEntryFact {
  title: string;
  /** The permalink the feed carried, when it carried one. */
  url: string | null;
  /** "YYYY-MM-DD" as the publisher dated it, or null when the feed dated nothing. */
  publishedAt: string | null;
  /** feature | improvement | fix | breaking | deprecation | security */
  itemType: string | null;
  /**
   * Verbatim from the item, substring-verified before it was stored. Present on a
   * `competitor_named_you` block, where the sentence naming the user IS the fact —
   * a title and a link would otherwise leave the reader to go and find it.
   */
  snippet?: string | null;
}

/** One customer we had never seen this competitor claim. */
export interface CustomerFact {
  /** As the page wrote it. */
  name: string;
  /** "YYYY-MM-DD" — when WE first saw them, which is the only date we have. */
  firstSeenAt: string | null;
  /** Where we saw them: the customers page, or the story that named them. */
  evidenceUrl: string | null;
}

/** One roadmap request that moved, as the portal published it (P5). */
export interface RoadmapRequestFact {
  title: string;
  url: string | null;
  /** Exact count the portal published, at the capture that saw the move. */
  votes: number;
  /** 1-based, among that portal's open requests. */
  rank: number;
  /** The portal's OWN status words, both sides. Null before = it was not listed. */
  fromRaw: string | null;
  toRaw: string;
}

/** One rival a competitor started pointing at (Positioning v2 P2). */
export interface ComparisonTargetFact {
  /** Prettified from the slug they published — "klue" → "Klue". */
  name: string;
  /** The exact page that names them. Null only for a mention with no permalink. */
  evidenceUrl: string | null;
  /** "YYYY-MM-DD" — when WE first saw them named, the only date a slug gives us. */
  firstSeenAt: string | null;
}

/** One integration a competitor lists that we had never seen it claim (P5). */
export interface IntegrationFact {
  /** As the catalog wrote it, or its own listing slug title-cased. */
  name: string;
  /** "YYYY-MM-DD" — when WE first saw it, the only date a catalog gives us. */
  firstSeenAt: string | null;
  evidenceUrl: string | null;
}

/** One subject a competitor's blog covered in a window, and how much of it. */
export interface TopicFact {
  topic: string;
  count: number;
}

/** One subject and where it stood in each of the two windows. */
export interface TopicMoveFact {
  topic: string;
  /** Posts carrying it in the newer window. */
  now: number;
  /** And in the older one. */
  then: number;
}

/** The cadence a shipping_velocity signal is about, and the months behind it. */
export interface VelocityFact {
  month: string;
  count: number;
  baselineAvg: number;
  direction: "accelerating" | "slowing";
  baseline: Array<{ month: string; count: number }>;
}

/** How a competitor described itself, before and after (Positioning v2 P1). */
export interface MessagingFact {
  h1Before: string | null;
  h1After: string;
  subheadlineBefore: string | null;
  subheadlineAfter: string | null;
  /** Both sides only when the CTA itself moved — an unchanged CTA is noise here. */
  ctaBefore: string | null;
  ctaAfter: string | null;
  /** "YYYY-MM-DD" the previous wording first appeared, so the reader knows how
   *  long it stood. Null when this is the first wording we ever recorded. */
  previousSince: string | null;
}

/** One quantified claim that moved, in the words the page printed. */
export interface ClaimFact {
  /** "customers", "uptime" — the thing being counted. */
  context: string;
  /** VERBATIM spans, both sides: "10,000+ customers" → "15,000+ customers". */
  before: string;
  after: string;
  /** Signed fractional move, as the detector computed it. */
  variation: number;
  /** The round number this crossed (10000, 1000000…), when it crossed one. */
  milestone: number | null;
  /** Every value we hold for this claim, oldest first — the mini timeline that
   *  turns one jump into a trajectory. */
  series: Array<{ observedAt: string; value: number; rawText: string }>;
}

/** One open role behind a salary band, with the range its own posting states. */
export interface BandRoleFact {
  title: string;
  url: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
}

export type SignalFacts =
  | {
      /** The band that moved, and the roles it was computed over (P3). */
      kind: "salary";
      bucketLabel: string;
      currency: string;
      p50Before: number;
      p50After: number;
      n: number;
      /** Trailing weeks the baseline was taken over, oldest first. */
      trailing: Array<{ weekStart: string; p50: number; n: number }>;
      roles: BandRoleFact[];
      /** Roles before the cap, so a truncated list can say what it is hiding. */
      rolesTotal: number;
    }
  | {
      kind: "hiring";
      opened: RoleFact[];
      closed: RoleFact[];
      /** Totals before the cap, so a truncated list can say what it is hiding. */
      openedTotal: number;
      closedTotal: number;
      /** Roles open right now, the denominator the opened count reads against. */
      openNow: number;
    }
  | {
      kind: "pricing";
      plans: PlanFact[];
      /** Free-trial facts as of this capture. null when never assessed. */
      trial: { hasTrial: boolean; days: number | null; requiresCard: boolean | null } | null;
      /** Packaging moves of this capture; [] when the matrix didn't change
       * (or was never captured). */
      entitlements: EntitlementFact[];
      /** Volume-ladder moves of this capture; [] when no ladder was captured
       * on either side, or it stood still. */
      tiers: TierFact[];
    }
  | {
      /** The JD-mined facts this signal published (Hiring Intelligence v2 P1). */
      kind: "job_facts";
      facts: JobFact[];
    }
  | {
      /** The entries a competitor published (Content Intelligence v2 P1). A
       * changelog signal names them; a cadence signal names them AND the months
       * the count moved against. */
      kind: "content";
      entries: ContentEntryFact[];
      /** Entries before the cap, so a truncated list can say what it is hiding. */
      entriesTotal: number;
      velocity: VelocityFact | null;
    }
  | {
      /** The customer story this signal is about (Content Intelligence v2 P3). */
      kind: "case_study";
      title: string | null;
      url: string;
      /** Null on an anonymised story — which is a fact, not a gap. */
      customerName: string | null;
      /** Human label of the market ("HR tech"), or the page's own wording. */
      industry: string | null;
      /** The reader's own market and the story's are the same catalog slug. */
      sameMarket: boolean;
      /** Result claims VERBATIM from the page, substring-verified before storage. */
      metrics: string[];
    }
  | {
      /** Customers named for the first time (Content Intelligence v2 P3). */
      kind: "customer_win";
      customers: CustomerFact[];
      /** Names before the cap, so a truncated list can say what it is hiding. */
      customersTotal: number;
      /** The page they were read off, so a win can be checked at its source. */
      evidenceUrl: string | null;
    }
  | {
      /** The roadmap move this signal is about (Content Intelligence v2 P5). */
      kind: "roadmap_request";
      request: RoadmapRequestFact;
      /** Other top requests committed in the SAME capture, named beside it. */
      alsoMoved: RoadmapRequestFact[];
    }
  | {
      /** Rivals a competitor started publishing against (Positioning v2 P2). */
      kind: "comparison_targets";
      targets: ComparisonTargetFact[];
      /** Names before the cap, so a truncated list can say what it is hiding. */
      targetsTotal: number;
    }
  | {
      /** Integrations newly listed in a catalog (Content Intelligence v2 P5). */
      kind: "integrations";
      integrations: IntegrationFact[];
      /** Names before the cap, so a truncated list can say what it is hiding. */
      integrationsTotal: number;
      /** The catalog page they were read off. */
      evidenceUrl: string | null;
    }
  | {
      /** How a homepage signal's competitor describes itself, before and after,
       *  and which of its quantified claims moved (Positioning v2 P1). Either
       *  half can be absent — a hero rewrite with no claim move, or a claim move
       *  under untouched copy, are both ordinary. */
      kind: "positioning";
      messaging: MessagingFact | null;
      claims: ClaimFact[];
    }
  | {
      /** The two windows an `editorial_pivot` compared (Content Intelligence v2 P4). */
      kind: "editorial";
      /** Jensen-Shannon, base 2, so it reads on a real 0-to-1 scale. */
      divergence: number;
      windowDays: number;
      /** Posts READ in each window — the denominator both minimums are checked on. */
      currentPosts: number;
      previousPosts: number;
      currentTopics: TopicFact[];
      previousTopics: TopicFact[];
      rising: TopicMoveFact[];
      declining: TopicMoveFact[];
    }
  | {
      /** The third-party technology a competitor started using (patch-18). */
      kind: "tech_stack";
      techs: TechFact[];
    }
  | {
      /** The public rating behind a reviews signal, and what it moved from. */
      kind: "reviews";
      /** The surface it was read off ("appstore", "trustpilot"). */
      source: string;
      score: number | null;
      previousScore: number | null;
      reviewCount: number | null;
      previousReviewCount: number | null;
      /** Recurring complaints clustered from the same capture; [] when none. */
      complaints: ComplaintFact[];
    }
  | null;

interface TechFact {
  name: string;
  category: string;
  importance: string;
  /** Where it was detected, verbatim: a response header, a script URL, a DOM
   * marker. This is what makes the detection checkable rather than asserted. */
  evidence: string[];
  firstDetectedAt: string | null;
}

interface ComplaintFact {
  theme: string;
  prevalence: string;
}

// A board can open fifty roles at once and a catalog can carry thirty plans. The
// point of the block is to name what moved, not to reproduce the page, so the
// lists are capped and the totals travel alongside.
const MAX_ROLES = 25;
const MAX_PLANS = 30;
const MAX_ENTITLEMENT_FACTS = 10;
const MAX_TIER_FACTS = 8;
// A single technology can be cited across a dozen postings; the block names the
// evidence, it does not reproduce the board.
const MAX_JOB_FACTS = 12;
// A band can be computed over thirty roles; the block shows enough to check the
// number against the source, not the whole board.
const MAX_BAND_ROLES = 8;
// A release month can hold forty entries; the block names the release, it does
// not reproduce the changelog.
const MAX_CONTENT_ENTRIES = 12;
// A wall refresh can add a dozen logos at once; the block names the win, it does
// not reproduce the customers page.
const MAX_CUSTOMER_FACTS = 12;
// A push can open a front against several rivals at once; the block names them, it
// does not reproduce their comparison hub.
const MAX_COMPARISON_TARGET_FACTS = 10;
// A catalog release can list a batch of connectors; the block names them, it does
// not reproduce the catalog.
const MAX_INTEGRATION_FACTS = 12;
// Evidence per technology. A detector can match a dozen headers on one vendor;
// two or three name where it was seen, which is the whole job of the list.
const MAX_TECH_EVIDENCE = 4;
// Complaint themes are already clustered by the extractor, so the tail is the
// long one. The top few are what a reader acts on.
const MAX_COMPLAINT_FACTS = 5;

// How long after a change its extraction may still land. The extractor is
// enqueued in the same scrape run, but it is the WORKER that stamps the row, and
// queue waits past an hour have been measured on prod. Six hours is far beyond
// the observed tail while staying well inside the daily-or-slower cadence of the
// sources this reads, and the next change on the same monitor closes the window
// early anyway.
const WINDOW_AHEAD_HOURS = 6;
// A small look-back: nothing should precede the change, but clock skew between
// the row that records the diff and the row that records the extraction is not
// worth losing a fact over.
const WINDOW_BEHIND_MINUTES = 5;

/**
 * The interval a change may claim extraction rows from.
 *
 * Bounded ahead by the NEXT change on the same monitor: a forced re-scan can put
 * two captures hours apart, and without that bound the earlier change would
 * happily claim the later capture's roles. With it, a row is attributed only when
 * no later change could own it.
 */
async function attributionWindow(
  monitorId: string,
  detectedAt: Date,
): Promise<{ lower: Date; upper: Date }> {
  const [next] = await db
    .select({ detectedAt: changes.detectedAt })
    .from(changes)
    // A typed comparison, not a `sql` fragment: a Date interpolated into a raw
    // template carries no encoder, and the driver rejects it outright. Every
    // caller here is wrapped in a try/catch that returns null, so the throw did
    // not surface as an error — it silently emptied EVERY fact block.
    .where(and(eq(changes.monitorId, monitorId), gt(changes.detectedAt, detectedAt)))
    .orderBy(changes.detectedAt)
    .limit(1);

  const ceiling = new Date(detectedAt.getTime() + WINDOW_AHEAD_HOURS * 3_600_000);
  const nextAt = next?.detectedAt ? new Date(next.detectedAt) : null;
  return {
    lower: new Date(detectedAt.getTime() - WINDOW_BEHIND_MINUTES * 60_000),
    upper: nextAt && nextAt < ceiling ? nextAt : ceiling,
  };
}

const toRole = (r: {
  title: string;
  department: string | null;
  location: string | null;
  seniority: string | null;
  url: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): RoleFact => r;

async function hiringFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const columns = {
    title: jobPostings.title,
    department: jobPostings.department,
    location: jobPostings.location,
    seniority: jobPostings.seniority,
    url: jobPostings.url,
    salaryMin: jobPostings.salaryMin,
    salaryMax: jobPostings.salaryMax,
    salaryCurrency: jobPostings.salaryCurrency,
  };

  const [opened, closed, [openNow]] = await Promise.all([
    db
      .select(columns)
      .from(jobPostings)
      .where(
        and(
          eq(jobPostings.competitorId, competitorId),
          gte(jobPostings.detectedAt, window.lower),
          lte(jobPostings.detectedAt, window.upper),
        ),
      )
      .orderBy(jobPostings.title)
      .limit(MAX_ROLES + 1),
    db
      .select(columns)
      .from(jobPostings)
      .where(
        and(
          eq(jobPostings.competitorId, competitorId),
          gte(jobPostings.closedAt, window.lower),
          lte(jobPostings.closedAt, window.upper),
        ),
      )
      .orderBy(jobPostings.title)
      .limit(MAX_ROLES + 1),
    db
      .select({ n: dsql<number>`count(*)::int` })
      .from(jobPostings)
      .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true))),
  ]);

  if (opened.length === 0 && closed.length === 0) return null;
  return {
    kind: "hiring",
    opened: opened.slice(0, MAX_ROLES).map(toRole),
    closed: closed.slice(0, MAX_ROLES).map(toRole),
    openedTotal: opened.length,
    closedTotal: closed.length,
    openNow: openNow?.n ?? 0,
  };
}

/**
 * The facts a `job_facts` signal published, joined on the same read-time window
 * every other block here uses. `signalled_at` is stamped by the miner at the
 * instant it wrote the change, so the window that finds the change's siblings
 * finds exactly the facts it was about — including the older postings a
 * corroborated technology was cited in, which is the whole point of the block.
 */
async function jobFactsFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const rows = await db
    .select({
      kind: postingFacts.kind,
      value: postingFacts.value,
      evidenceSnippet: postingFacts.evidenceSnippet,
      postingTitle: jobPostings.title,
      postingUrl: jobPostings.url,
    })
    .from(postingFacts)
    .innerJoin(jobPostings, eq(jobPostings.id, postingFacts.postingId))
    .where(
      and(
        eq(postingFacts.competitorId, competitorId),
        gte(postingFacts.signalledAt, window.lower),
        lte(postingFacts.signalledAt, window.upper),
      ),
    )
    .orderBy(postingFacts.kind, jobPostings.title)
    .limit(MAX_JOB_FACTS);

  if (rows.length === 0) return null;
  return { kind: "job_facts", facts: rows };
}

/**
 * The entries a changelog signal is about: the ones first seen inside the same
 * attribution window every other block here uses.
 *
 * `first_seen_at` and not `published_at`: a feed can carry a two-year archive, and
 * what this signal is about is what appeared between two captures. The date shown
 * is still the publisher's own — a day-precision string read straight out of the
 * column, so no timezone can move it by one.
 */
async function changelogFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  // Typed helpers, not a raw fragment: a Date bound into a `sql` template has no
  // encoder attached, and the driver rejects it. Here that would surface as the
  // block silently never rendering, since buildSignalFacts swallows read errors.
  const rows = await contentEntriesIn(
    competitorId,
    and(gte(contentItems.firstSeenAt, window.lower), lte(contentItems.firstSeenAt, window.upper))!,
  );
  if (rows.length === 0) return null;
  return {
    kind: "content",
    entries: rows.slice(0, MAX_CONTENT_ENTRIES),
    entriesTotal: rows.length,
    velocity: null,
  };
}

/**
 * The cadence a `shipping_velocity_shift` was about, and the entries of the month
 * that moved.
 *
 * The numbers come off the change's OWN rawDiff rather than being recomputed: the
 * detector already decided which month crossed and against which trailing months,
 * and re-deriving them from a feed that has published more since would print a
 * reader numbers that contradict the sentence above them. The entries are then
 * fetched for that exact month, which is what makes the count checkable.
 */
async function velocityFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "shipping_velocity_shift") return null;
  const month = typeof raw.month === "string" ? raw.month : null;
  const direction = raw.direction === "slowing" ? "slowing" : "accelerating";
  if (!month) return null;

  const rows = await contentEntriesIn(
    competitorId,
    dsql`to_char(${contentItems.publishedAt}, 'YYYY-MM') = ${month}`,
  );
  return {
    kind: "content",
    entries: rows.slice(0, MAX_CONTENT_ENTRIES),
    entriesTotal: rows.length,
    velocity: {
      month,
      count: Number(raw.count ?? rows.length),
      baselineAvg: Number(raw.baselineAvg ?? 0),
      direction,
      baseline: Array.isArray(raw.baseline)
        ? (raw.baseline as Array<{ month: string; count: number }>)
        : [],
    },
  };
}

/** Topics a block names per window. Enough to check the move, not the whole blog. */
const MAX_TOPIC_FACTS = 5;

/**
 * The two windows an `editorial_pivot` compared (Content Intelligence v2 P4).
 *
 * Read off the change's OWN rawDiff, for the reason the cadence block is: the
 * detector already decided which posts fell in which window, and re-running the
 * distributions now — against a window that has since slid, over posts enriched
 * since — would print numbers that contradict the sentence above them.
 */
async function editorialFacts(monitorId: string, detectedAt: Date): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "editorial_pivot") return null;

  const topics = (value: unknown): TopicFact[] =>
    Array.isArray(value)
      ? (value as TopicFact[])
          .filter((t) => typeof t?.topic === "string")
          .slice(0, MAX_TOPIC_FACTS)
      : [];
  const moves = (value: unknown): TopicMoveFact[] =>
    Array.isArray(value)
      ? (value as TopicMoveFact[])
          .filter((t) => typeof t?.topic === "string")
          .slice(0, MAX_TOPIC_FACTS)
      : [];

  return {
    kind: "editorial",
    divergence: Number(raw.divergence ?? 0),
    windowDays: Number(raw.windowDays ?? 90),
    currentPosts: Number(raw.currentPosts ?? 0),
    previousPosts: Number(raw.previousPosts ?? 0),
    currentTopics: topics(raw.currentTopics),
    previousTopics: topics(raw.previousTopics),
    rising: moves(raw.rising),
    declining: moves(raw.declining),
  };
}

/**
 * The post behind a `competitor_named_you` signal (Content Intelligence v2 P2).
 *
 * Read off the change's OWN rawDiff — the URL it recorded — rather than a time
 * window: the signal is about ONE post, the emitter named it, and a window would
 * pull in whatever else the same capture published.
 *
 * The sitemap source writes onto this same anchor with no `kind`, so those changes
 * fall through to null and render exactly as they do today.
 */
async function comparisonAnchorFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  // Positioning v2 P2 shares this anchor: the same monitor now carries "they named
  // YOU" and "they started naming Klue", which are the same subject seen from
  // either side. The `kind` on the change is what tells the two apart.
  if (raw?.kind === "new_comparison_target") {
    return await comparisonTargetFacts(competitorId, raw);
  }
  if (!raw || raw.kind !== "competitor_named_you") return null;
  const itemId = typeof raw.contentItemId === "string" ? raw.contentItemId : null;
  if (!itemId) return null;

  const [row] = await db
    .select({
      title: contentItems.title,
      url: contentItems.url,
      publishedAt: dsql<string | null>`to_char(${contentItems.publishedAt}, 'YYYY-MM-DD')`,
      itemType: contentItems.itemType,
      snippet: contentItems.evidenceSnippet,
    })
    .from(contentItems)
    .where(eq(contentItems.id, itemId))
    .limit(1);
  if (!row) return null;

  return { kind: "content", entries: [row], entriesTotal: 1, velocity: null };
}

/**
 * The rivals behind a `new_comparison_target` signal (Positioning v2 P2).
 *
 * Read off the change's OWN rawDiff — the names the emitter already decided —
 * rather than a time window. A window over `named_competitors` would sweep in
 * whatever else the same capture recorded, so a one-target front would render as
 * six. The row is what carries the URL and the date, so the block can print the
 * page a claim came from rather than asserting it.
 */
async function comparisonTargetFacts(
  competitorId: string,
  raw: Record<string, unknown>,
): Promise<SignalFacts> {
  const names = Array.isArray(raw.targets)
    ? raw.targets.filter((n): n is string => typeof n === "string")
    : [];
  if (names.length === 0) return null;

  const rows = await db
    .select({
      name: namedCompetitors.displayName,
      evidenceUrl: namedCompetitors.evidenceUrl,
      firstSeenAt: dsql<string | null>`to_char(${namedCompetitors.firstSeenAt}, 'YYYY-MM-DD')`,
      nameNormalized: namedCompetitors.nameNormalized,
    })
    .from(namedCompetitors)
    .where(
      and(
        eq(namedCompetitors.competitorId, competitorId),
        inArray(namedCompetitors.nameNormalized, names),
      ),
    )
    .orderBy(namedCompetitors.firstSeenAt);
  if (rows.length === 0) return null;

  // A target can hold a row per source; the block names each rival once, on the
  // evidence we saw first.
  const byName = new Map<string, ComparisonTargetFact>();
  for (const row of rows) {
    if (byName.has(row.nameNormalized)) continue;
    byName.set(row.nameNormalized, {
      name: row.name,
      evidenceUrl: row.evidenceUrl,
      firstSeenAt: row.firstSeenAt,
    });
  }
  const targets = [...byName.values()];
  return {
    kind: "comparison_targets",
    targets: targets.slice(0, MAX_COMPARISON_TARGET_FACTS),
    targetsTotal: targets.length,
  };
}

/**
 * The customer proof behind a `case_study_published` or `customer_win` signal
 * (Content Intelligence v2 P3).
 *
 * Read off the change's OWN rawDiff — the story id, or the exact names — rather
 * than a time window. Both signals are about a NAMED set that the emitter already
 * decided; a window over `known_customers` would sweep in whatever else the same
 * run happened to record, so a one-customer win would render as four.
 */
async function customerFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw) return null;

  if (raw.kind === "case_study_published") {
    const id = typeof raw.caseStudyId === "string" ? raw.caseStudyId : null;
    if (!id) return null;
    const [row] = await db
      .select({
        title: caseStudies.title,
        url: caseStudies.url,
        customerName: caseStudies.customerName,
        industry: caseStudies.customerIndustry,
        industryLabel: caseStudies.customerIndustryLabel,
        isCanonical: caseStudies.isCanonicalIndustry,
        metrics: caseStudies.metricsClaimed,
      })
      .from(caseStudies)
      .where(eq(caseStudies.id, id))
      .limit(1);
    if (!row) return null;
    return {
      kind: "case_study",
      title: row.title,
      url: row.url,
      customerName: row.customerName,
      // A canonical slug renders as its shared label; a free-text one renders as
      // the page's own wording, which is all it ever was.
      industry: row.industry
        ? row.isCanonical === 1
          ? industryLabel(row.industry)
          : (row.industryLabel ?? row.industry.replace(/_/g, " "))
        : null,
      sameMarket: raw.sameMarket === true,
      metrics: row.metrics ?? [],
    };
  }

  if (raw.kind === "customer_win") {
    const names = Array.isArray(raw.names)
      ? raw.names.filter((n): n is string => typeof n === "string")
      : [];
    if (names.length === 0) return null;
    const rows = await db
      .select({
        name: knownCustomers.displayName,
        firstSeenAt: dsql<string | null>`to_char(${knownCustomers.firstSeenAt}, 'YYYY-MM-DD')`,
        evidenceUrl: knownCustomers.evidenceUrl,
      })
      .from(knownCustomers)
      .where(
        and(
          eq(knownCustomers.competitorId, competitorId),
          inArray(knownCustomers.displayName, names),
        ),
      )
      .orderBy(knownCustomers.firstSeenAt);
    if (rows.length === 0) return null;
    return {
      kind: "customer_win",
      customers: rows.slice(0, MAX_CUSTOMER_FACTS),
      customersTotal: rows.length,
      evidenceUrl: typeof raw.evidenceUrl === "string" ? raw.evidenceUrl : null,
    };
  }

  return null;
}

/**
 * The roadmap move behind a `top_request_planned` signal (Content Intelligence v2
 * P5).
 *
 * Read off the change's OWN rawDiff, never recomputed. The rank and the vote count
 * are what the portal published AT THE CAPTURE THAT SAW THE MOVE; by the time this
 * is read the portal has moved on, and a recomputed "#1, 142 votes" that contradicts
 * the sentence above it is worse than no block at all.
 */
async function roadmapFacts(monitorId: string, detectedAt: Date): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "top_request_planned") return null;
  const request = readRequest(raw);
  if (!request) return null;

  const alsoMoved = Array.isArray(raw.alsoMoved)
    ? raw.alsoMoved
        .map((entry) => readRequest(entry as Record<string, unknown>))
        .filter((r): r is RoadmapRequestFact => r !== null)
    : [];
  return { kind: "roadmap_request", request, alsoMoved };
}

/** One request out of a rawDiff, or null when the shape is not what we wrote. */
function readRequest(raw: Record<string, unknown>): RoadmapRequestFact | null {
  const title = typeof raw.title === "string" ? raw.title : null;
  const votes = typeof raw.votes === "number" ? raw.votes : null;
  const rank = typeof raw.rank === "number" ? raw.rank : null;
  const toRaw = typeof raw.toRaw === "string" ? raw.toRaw : null;
  if (!title || votes == null || rank == null || !toRaw) return null;
  return {
    title,
    url: typeof raw.url === "string" ? raw.url : null,
    votes,
    rank,
    fromRaw: typeof raw.fromRaw === "string" ? raw.fromRaw : null,
    toRaw,
  };
}

/**
 * The integrations behind an `integration_published` signal (Content Intelligence v2
 * P5).
 *
 * The names come off the change's rawDiff — the set the emitter decided — and the
 * registry supplies the date and the page each was seen on. A window over
 * `known_integrations` would sweep in whatever else the same run recorded, so a
 * one-name signal would render as five.
 */
async function integrationFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "integration_published") return null;
  const names = Array.isArray(raw.names)
    ? raw.names.filter((n): n is string => typeof n === "string")
    : [];
  if (names.length === 0) return null;

  const rows = await db
    .select({
      name: knownIntegrations.displayName,
      firstSeenAt: dsql<string | null>`to_char(${knownIntegrations.firstSeenAt}, 'YYYY-MM-DD')`,
      evidenceUrl: knownIntegrations.evidenceUrl,
    })
    .from(knownIntegrations)
    .where(
      and(
        eq(knownIntegrations.competitorId, competitorId),
        inArray(knownIntegrations.displayName, names),
      ),
    )
    .orderBy(knownIntegrations.firstSeenAt);
  if (rows.length === 0) return null;

  return {
    kind: "integrations",
    integrations: rows.slice(0, MAX_INTEGRATION_FACTS),
    integrationsTotal: rows.length,
    evidenceUrl: typeof raw.evidenceUrl === "string" ? raw.evidenceUrl : null,
  };
}

/** This competitor's changelog entries matching `predicate`, newest first. */
async function contentEntriesIn(
  competitorId: string,
  predicate: SQL,
): Promise<ContentEntryFact[]> {
  return db
    .select({
      title: contentItems.title,
      url: contentItems.url,
      // Day precision, straight out of the column: the publisher dated it, and a
      // Date round-trip through the API would let a timezone shift it by one.
      publishedAt: dsql<string | null>`to_char(${contentItems.publishedAt}, 'YYYY-MM-DD')`,
      itemType: contentItems.itemType,
    })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.competitorId, competitorId),
        eq(contentItems.sourceType, "changelog"),
        predicate,
      ),
    )
    .orderBy(dsql`${contentItems.publishedAt} desc nulls last`)
    .limit(MAX_CONTENT_ENTRIES + 1);
}

interface PlanRow {
  side: "current" | "previous";
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string;
  unit: string | null;
  includedQuantity: number | null;
  hasTrial: number | null;
  trialDays: number | null;
  trialRequiresCard: number | null;
}

const planKey = (p: { planName: string; billingPeriod: string }) =>
  `${p.planName} ${p.billingPeriod}`;

async function pricingFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  // Both batches in one read: the latest inside the window, and the one strictly
  // before it whatever its age (the previous capture is the baseline even when it
  // predates the window).
  // Bounds as ISO strings, not Dates: a `Date` interpolated into a raw `sql`
  // template carries no encoder and the driver rejects the bind outright — the
  // same trap `attributionWindow` documents. Here the throw is caught by
  // `analyticsQuery`'s best-effort contract, so it returned [] and the pricing
  // block silently rendered nothing on EVERY pricing signal.
  const rows = await analyticsQuery<PlanRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM pricing_history
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at >= ${window.lower.toISOString()} AND recorded_at <= ${window.upper.toISOString()}
    ), prev AS (
      SELECT max(ph.recorded_at) AS ts FROM pricing_history ph, cur
      WHERE ph.competitor_id = ${competitorId} AND ph.origin = 'live'
        AND ph.recorded_at < cur.ts
    )
    SELECT 'current' AS side, ph.plan_name AS "planName", ph.price,
           ph.currency, ph.billing_period AS "billingPeriod",
           ph.unit, ph.included_quantity AS "includedQuantity",
           ph.has_trial AS "hasTrial", ph.trial_days AS "trialDays",
           ph.trial_requires_card AS "trialRequiresCard"
    FROM pricing_history ph, cur
    WHERE ph.competitor_id = ${competitorId} AND ph.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', ph.plan_name, ph.price, ph.currency, ph.billing_period,
           ph.unit, ph.included_quantity,
           ph.has_trial, ph.trial_days, ph.trial_requires_card
    FROM pricing_history ph, prev
    WHERE ph.competitor_id = ${competitorId} AND ph.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  if (current.length === 0) return null;
  const previous = rows.filter((r) => r.side === "previous");
  const prevByKey = new Map(previous.map((p) => [planKey(p), p]));
  const curKeys = new Set(current.map(planKey));

  // With no prior batch this is the first capture: every plan is simply present,
  // none of it is news. Claiming thirty plans were "added" would read as a launch.
  const isFirst = previous.length === 0;

  const plans: PlanFact[] = current.map((p) => {
    const before = prevByKey.get(planKey(p));
    // A plan "changed" when its price moved OR its bundled quantity did — a
    // shrunk bundle at a flat price (shrinkflation) must lead like a price cut.
    const quantityMoved =
      before != null &&
      before.includedQuantity !== null &&
      p.includedQuantity !== null &&
      before.includedQuantity !== p.includedQuantity;
    const state: PlanFact["state"] = isFirst
      ? "unchanged"
      : !before
        ? "added"
        : before.price !== p.price || quantityMoved
          ? "changed"
          : "unchanged";
    return {
      planName: p.planName,
      billingPeriod: p.billingPeriod,
      currency: p.currency,
      price: p.price,
      previousPrice: before?.price ?? null,
      unit: p.unit,
      includedQuantity: p.includedQuantity,
      previousIncludedQuantity: before?.includedQuantity ?? null,
      state,
    };
  });

  if (!isFirst) {
    for (const p of previous) {
      if (curKeys.has(planKey(p))) continue;
      plans.push({
        planName: p.planName,
        billingPeriod: p.billingPeriod,
        currency: p.currency,
        price: null,
        previousPrice: p.price,
        unit: p.unit,
        includedQuantity: null,
        previousIncludedQuantity: p.includedQuantity,
        state: "removed",
      });
    }
  }

  // What moved leads; the rest keeps the page's own order behind it.
  const rank: Record<PlanFact["state"], number> = {
    changed: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  plans.sort((a, b) => rank[a.state] - rank[b.state]);

  // Trial facts are stamped page-level onto every row of the batch, so any row
  // carries them. null hasTrial means the capture predates the detection.
  const stamp = current[0]!;
  return {
    kind: "pricing",
    plans: plans.slice(0, MAX_PLANS),
    entitlements: await entitlementFacts(competitorId, window),
    tiers: await tierFacts(competitorId, window, stampCurrency(current)),
    trial:
      stamp.hasTrial === null
        ? null
        : {
            hasTrial: stamp.hasTrial === 1,
            days: stamp.trialDays,
            requiresCard: stamp.trialRequiresCard === null ? null : stamp.trialRequiresCard === 1,
          },
  };
}

/** The currency the bands are priced in — price_tiers stores the ladder,
 * pricing_history stores what it costs in, and the two are one capture. */
function stampCurrency(current: PlanRow[]): string | null {
  return current.find((p) => p.currency)?.currency ?? null;
}

interface TierBatchRow extends TierBandRow {
  side: "current" | "previous";
}

/**
 * The volume-ladder moves of the capture: the latest price_tiers batch inside
 * the window vs the one strictly before it, re-diffed at read time like the
 * entitlement block. A ladder captured on only one side stays silent — the
 * differ's own rule, so the block cannot claim a ladder appeared when it was
 * the extractor that finally read one.
 */
async function tierFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
  currency: string | null,
): Promise<TierFact[]> {
  const rows = await analyticsQuery<TierBatchRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM price_tiers
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at >= ${window.lower.toISOString()} AND recorded_at <= ${window.upper.toISOString()}
    ), prev AS (
      SELECT max(pt.recorded_at) AS ts FROM price_tiers pt, cur
      WHERE pt.competitor_id = ${competitorId} AND pt.origin = 'live'
        AND pt.recorded_at < cur.ts
    )
    SELECT 'current' AS side, pt.plan_name, pt.unit, pt.from_qty, pt.to_qty,
           pt.unit_price, pt.flat_fee
    FROM price_tiers pt, cur
    WHERE pt.competitor_id = ${competitorId} AND pt.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', pt.plan_name, pt.unit, pt.from_qty, pt.to_qty,
           pt.unit_price, pt.flat_fee
    FROM price_tiers pt, prev
    WHERE pt.competitor_id = ${competitorId} AND pt.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  const previous = rows.filter((r) => r.side === "previous");
  if (current.length === 0 || previous.length === 0) return [];

  return diffPriceTiers(previous, current, { currency })
    .slice(0, MAX_TIER_FACTS)
    .map((c) => ({
      planName: c.planName ?? "",
      state: c.type === "tier_boundary_moved" ? ("boundary_moved" as const) : ("rate_changed" as const),
      before: c.humanBefore,
      after: c.humanAfter,
    }));
}

interface EntitlementBatchRow extends EntitlementRow {
  side: "current" | "previous";
}

/**
 * The packaging moves of the capture: the latest entitlement batch inside the
 * window vs the one strictly before it, re-diffed by the shared differ at read
 * time (retroactive, like every fact here — no change_id stamp to backfill).
 * Free-text label rewordings stay silent by the differ's own canonical-only
 * rule, so the block never claims a feature was "removed" over a copy edit.
 */
async function entitlementFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<EntitlementFact[]> {
  const rows = await analyticsQuery<EntitlementBatchRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM plan_entitlements
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${window.lower.toISOString()} AND recorded_at <= ${window.upper.toISOString()}
    ), prev AS (
      SELECT max(pe.recorded_at) AS ts FROM plan_entitlements pe, cur
      WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at < cur.ts
    )
    SELECT 'current' AS side, pe.plan_name, pe.feature_slug, pe.feature_label,
           pe.kind, pe.value_num, pe.value_text, pe.unit, pe.reset_period,
           pe.is_canonical
    FROM plan_entitlements pe, cur
    WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', pe.plan_name, pe.feature_slug, pe.feature_label,
           pe.kind, pe.value_num, pe.value_text, pe.unit, pe.reset_period,
           pe.is_canonical
    FROM plan_entitlements pe, prev
    WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  const previous = rows.filter((r) => r.side === "previous");
  if (current.length === 0 || previous.length === 0) return [];

  // moved/added/removed human strings lead with the feature ("SSO — Pro");
  // limit_changed leads with the PLAN ("Starter — 5 seats"), so its feature
  // label is recovered from the current batch row the change was derived from.
  const label = (c: {
    type: string;
    planName: string | null;
    currentValue: number | null;
    humanBefore: string | null;
    humanAfter: string | null;
  }): string => {
    if (c.type === "entitlement_limit_changed") {
      const hit = current.find(
        (r) => r.plan_name === c.planName && r.value_num === c.currentValue,
      );
      if (hit) return hit.feature_label;
    }
    return (c.humanAfter ?? c.humanBefore ?? "").split(" — ")[0] ?? "";
  };

  return diffEntitlements(previous, current)
    .slice(0, MAX_ENTITLEMENT_FACTS)
    .map((c) => ({
      featureLabel: label(c),
      state:
        c.type === "entitlement_moved"
          ? ("moved" as const)
          : c.type === "entitlement_limit_changed"
            ? ("limit_changed" as const)
            : c.type === "entitlement_added"
              ? ("added" as const)
              : ("removed" as const),
      before: c.humanBefore,
      after: c.humanAfter,
    }));
}

/**
 * The band a `salary_band_shift` signal was about, and the roles behind it.
 *
 * Read off the change's OWN rawDiff rather than recomputed: the detector already
 * decided which (bucket, currency) moved and against which trailing weeks, and
 * re-deriving it here from a board that has moved since would show a reader numbers
 * that do not match the sentence above them.
 *
 * The roles are the current open ones quoted in that currency — they are what makes
 * the median checkable, since each carries the range its own posting prints.
 */
async function salaryFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "salary_band_shift") return null;
  const bucket = typeof raw.bucket === "string" ? raw.bucket : null;
  const currency = typeof raw.currency === "string" ? raw.currency : null;
  if (!bucket || !currency) return null;

  const roles = await db
    .select({
      title: jobPostings.title,
      url: jobPostings.url,
      location: jobPostings.location,
      department: jobPostings.department,
      salaryMin: jobPostings.salaryMin,
      salaryMax: jobPostings.salaryMax,
    })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        eq(jobPostings.isActive, true),
        eq(jobPostings.salaryCurrency, currency),
        dsql`(${jobPostings.salaryMin} is not null or ${jobPostings.salaryMax} is not null)`,
      ),
    )
    .orderBy(jobPostings.title);

  // The bucket is derived, not stored, so the department filter happens here — with
  // the same normalizer the band was built by, so the two can not disagree.
  const inBucket = roles.filter((r) => normalizeDepartment(r.department, null, r.title) === bucket);

  return {
    kind: "salary",
    bucketLabel: DEPARTMENT_BUCKET_LABELS[bucket as DepartmentBucket] ?? bucket,
    currency,
    p50Before: Number(raw.p50Before ?? 0),
    p50After: Number(raw.p50After ?? 0),
    n: Number(raw.n ?? inBucket.length),
    trailing: Array.isArray(raw.trailing)
      ? (raw.trailing as Array<{ weekStart: string; p50: number; n: number }>)
      : [],
    roles: inBucket.slice(0, MAX_BAND_ROLES).map(({ department: _d, ...role }) => role),
    rolesTotal: inBucket.length,
  };
}

// A homepage can print a dozen quantified brags; the block names what moved, it
// does not reproduce the page.
const MAX_CLAIM_FACTS = 6;
// Enough of a claim's history to read it as a trajectory rather than a jump.
const MAX_CLAIM_SERIES = 8;

interface ClaimSeriesRow {
  pattern: string;
  unit: string;
  context: string;
  value: number;
  raw_text: string;
  observed_at: string;
}

/**
 * What a homepage signal's competitor now says about itself, against what it said
 * before, plus the quantified claims that moved with it (Positioning v2 P1).
 *
 * Deliberately NOT a second signal. A hero rewrite already reaches the reader
 * through the homepage classifier — what it could never say was what the copy
 * changed FROM, because the previous wording lived only inside a snapshot nobody
 * read. The materialised timeline holds it, so the signal that already exists
 * gains its other half instead of gaining a duplicate.
 *
 * The claims are read off the change's OWN structured diff rather than recomputed:
 * the detector already decided which claim moved and against which prior value,
 * and re-deriving it from a table that has since taken new observations would
 * print numbers that contradict the sentence above them. The verbatim spans it
 * carries are what the competitor PUBLISHED — "10,000+ customers", not our
 * rendering of the integer we parsed out of it.
 */
async function positioningFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const [change] = await db
    .select({ structuredDiff: changes.structuredDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  // The two most recent versions at or before this capture: the one this capture
  // opened (when it opened one) and the wording it replaced.
  const versions = await db
    .select({
      h1: messagingVersions.h1,
      subheadline: messagingVersions.subheadline,
      primaryCta: messagingVersions.primaryCta,
      capturedAt: messagingVersions.capturedAt,
    })
    .from(messagingVersions)
    .where(
      and(
        eq(messagingVersions.competitorId, competitorId),
        lte(messagingVersions.capturedAt, window.upper),
      ),
    )
    .orderBy(desc(messagingVersions.capturedAt))
    .limit(2);

  const [current, previous] = versions;
  // A version only counts as THIS signal's when the capture that opened it falls
  // in the window. Otherwise the copy stood still and the signal is about
  // something else on the page — printing the standing wording as a "change"
  // would invent a rewrite.
  const opened = current && current.capturedAt >= window.lower ? current : null;
  const messaging: MessagingFact | null =
    opened && opened.h1
      ? {
          h1Before: previous?.h1 ?? null,
          h1After: opened.h1,
          subheadlineBefore: previous?.subheadline ?? null,
          subheadlineAfter: opened.subheadline,
          ctaBefore: previous && previous.primaryCta !== opened.primaryCta ? previous.primaryCta : null,
          ctaAfter: previous && previous.primaryCta !== opened.primaryCta ? opened.primaryCta : null,
          previousSince: previous ? previous.capturedAt.toISOString().slice(0, 10) : null,
        }
      : null;

  const diff = Array.isArray(change?.structuredDiff)
    ? (change.structuredDiff as Array<{ kind?: string; metadata?: Record<string, unknown> | null }>)
    : [];
  const moved = diff
    .filter((c) => c.kind === "numeric_claim_changed")
    .slice(0, MAX_CLAIM_FACTS)
    .map((c) => c.metadata ?? {})
    .filter((m) => typeof m.rawTextBefore === "string" && typeof m.rawTextAfter === "string");

  let claims: ClaimFact[] = [];
  if (moved.length > 0) {
    // One read for every claim in the block: the series is the same table, keyed
    // by the same triple the detector compared on.
    const rows =
      (await analyticsQuery<ClaimSeriesRow>(sql`
        SELECT pattern, unit, context, value, raw_text, observed_at::text AS observed_at
        FROM numeric_claims
        WHERE competitor_id = ${competitorId}
        ORDER BY observed_at DESC
        LIMIT 400
      `)) ?? [];

    claims = moved.map((m) => {
      const key = `${String(m.pattern ?? "")}|${String(m.unit ?? "")}|${String(m.context ?? "")}`;
      const series = rows
        .filter((r) => `${r.pattern}|${r.unit ?? ""}|${r.context}` === key)
        .slice(0, MAX_CLAIM_SERIES)
        .reverse()
        .map((r) => ({ observedAt: r.observed_at, value: r.value, rawText: r.raw_text }));
      return {
        context: String(m.context ?? ""),
        before: String(m.rawTextBefore),
        after: String(m.rawTextAfter),
        variation: typeof m.variation === "number" ? m.variation : 0,
        milestone: typeof m.milestone === "number" ? m.milestone : null,
        series,
      };
    });
  }

  if (!messaging && claims.length === 0) return null;
  return { kind: "positioning", messaging, claims };
}

/**
 * The structured facts behind one signal, or null when its source has none.
 *
 * Best-effort by construction: a signal must still render if these reads fail,
 * so every caller treats null as "nothing to add" rather than an error. Jobs,
 * pricing, the JD-mined job_facts anchor, salary bands and the published content
 * items (changelog + the shipping-cadence anchor) are wired up. Reviews and tech
 * stack already carry a before/after pair from their deterministic detectors, so
 * they are the smaller gap; see docs/signal-evidence-audit.md wave 2.
 */
/**
 * The technology behind a tech-stack signal, with the evidence it was read off.
 *
 * The insight says a competitor "has adopted Vercel"; the reader's next question
 * is how we know, and the answer was sitting unused in `tech_stack_entries`.
 * Names come off the change's rawDiff — the set the detector decided — for the
 * same reason integrations do: a window over the entries table would sweep in
 * everything else the same monthly scan recorded, so a one-tech signal would
 * render as five.
 */
async function techStackFacts(
  competitorId: string,
  monitorId: string,
  detectedAt: Date,
): Promise<SignalFacts> {
  const [change] = await db
    .select({ rawDiff: changes.rawDiff })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), eq(changes.detectedAt, detectedAt)))
    .limit(1);

  const raw = change?.rawDiff as Record<string, unknown> | null | undefined;
  const names = Array.isArray(raw?.added)
    ? raw.added.filter((n): n is string => typeof n === "string")
    : [];
  if (names.length === 0) return null;

  const rows = await db
    .select({
      name: techStackEntries.techName,
      category: techStackEntries.category,
      importance: techStackEntries.importance,
      evidence: techStackEntries.evidence,
      firstDetectedAt: dsql<
        string | null
      >`to_char(${techStackEntries.firstDetectedAt}, 'YYYY-MM-DD')`,
    })
    .from(techStackEntries)
    .where(
      and(
        eq(techStackEntries.competitorId, competitorId),
        inArray(techStackEntries.techName, names),
      ),
    )
    .orderBy(techStackEntries.techName);
  if (rows.length === 0) return null;

  return {
    kind: "tech_stack",
    techs: rows.map((r) => ({
      ...r,
      // The column is typed as a string list, but it is jsonb: a row written by
      // an older detector can hold anything, and a block that renders `[object
      // Object]` as evidence is worse than one that renders none.
      evidence: Array.isArray(r.evidence)
        ? r.evidence.filter((e): e is string => typeof e === "string").slice(0, MAX_TECH_EVIDENCE)
        : [],
    })),
  };
}

/**
 * The rating a reviews signal is about, against the capture before it.
 *
 * A reviews signal said the score moved and showed neither number. Both are in
 * `review_scores`, written by the same scrape: the latest row inside the
 * attribution window, and the one strictly before it whatever its age, exactly
 * as the pricing block reads its two batches.
 *
 * Sub-scores are deliberately not read. The column exists, but every surface
 * still collected (App Store, Trustpilot's public API) publishes an aggregate
 * only, so the field is null on every row in production and a block that
 * rendered it would be describing the shape of the table, not the competitor.
 */
async function reviewFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const rows = await analyticsQuery<{
    side: "current" | "previous";
    source: string;
    score: number | null;
    reviewCount: number | null;
    complaintThemes: unknown;
  }>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM review_scores
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${window.lower.toISOString()}
        AND recorded_at <= ${window.upper.toISOString()}
    ), prev AS (
      SELECT max(rs.recorded_at) AS ts FROM review_scores rs, cur
      WHERE rs.competitor_id = ${competitorId} AND rs.recorded_at < cur.ts
    )
    SELECT 'current' AS side, rs.source, rs.score,
           rs.review_count AS "reviewCount", rs.complaint_themes AS "complaintThemes"
    FROM review_scores rs, cur
    WHERE rs.competitor_id = ${competitorId} AND rs.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', rs.source, rs.score, rs.review_count, rs.complaint_themes
    FROM review_scores rs, prev
    WHERE rs.competitor_id = ${competitorId} AND rs.recorded_at = prev.ts
  `);

  const current = rows.find((r) => r.side === "current");
  if (!current) return null;
  const previous = rows.find((r) => r.side === "previous") ?? null;

  const complaints = Array.isArray(current.complaintThemes)
    ? (current.complaintThemes as unknown[])
        .filter(
          (c): c is ComplaintFact =>
            typeof c === "object" &&
            c !== null &&
            typeof (c as ComplaintFact).theme === "string" &&
            typeof (c as ComplaintFact).prevalence === "string",
        )
        .slice(0, MAX_COMPLAINT_FACTS)
    : [];

  return {
    kind: "reviews",
    source: current.source,
    score: current.score,
    previousScore: previous?.score ?? null,
    reviewCount: current.reviewCount,
    previousReviewCount: previous?.reviewCount ?? null,
    complaints,
  };
}

/** Review source types whose scrape writes a `review_scores` row. */
const REVIEW_SOURCES = new Set([
  "appstore_reviews",
  "shopify_reviews",
  "trustpilot_public",
  "g2_reviews",
  "capterra_reviews",
  "review_shift",
]);

export async function buildSignalFacts(args: {
  monitorId: string | null;
  competitorId: string;
  sourceType: string | null;
  detectedAt: Date | string | null;
}): Promise<SignalFacts> {
  const { monitorId, competitorId, sourceType, detectedAt } = args;
  if (!monitorId || !detectedAt) return null;
  if (
    sourceType !== "jobs" &&
    sourceType !== "pricing" &&
    sourceType !== "job_facts" &&
    sourceType !== "hiring_salary" &&
    sourceType !== "changelog" &&
    sourceType !== "shipping_velocity" &&
    sourceType !== "comparison_page" &&
    sourceType !== "customer_proof" &&
    sourceType !== "editorial_shift" &&
    sourceType !== "roadmap" &&
    sourceType !== "roadmap_shift" &&
    sourceType !== "integration_catalog" &&
    sourceType !== "tech_stack" &&
    sourceType !== "homepage" &&
    !REVIEW_SOURCES.has(sourceType ?? "")
  ) {
    return null;
  }

  try {
    // The salary and cadence blocks read the change's own rawDiff, not an
    // extraction window: their detectors already recorded what moved and against
    // what, and recomputing it from data that has since moved on would print
    // numbers that contradict the sentence above them.
    if (sourceType === "hiring_salary") {
      return await salaryFacts(competitorId, monitorId, new Date(detectedAt));
    }
    if (sourceType === "shipping_velocity") {
      return await velocityFacts(competitorId, monitorId, new Date(detectedAt));
    }
    if (sourceType === "comparison_page") {
      return await comparisonAnchorFacts(competitorId, monitorId, new Date(detectedAt));
    }
    if (sourceType === "customer_proof") {
      return await customerFacts(competitorId, monitorId, new Date(detectedAt));
    }
    if (sourceType === "editorial_shift") {
      return await editorialFacts(monitorId, new Date(detectedAt));
    }
    // A roadmap move rides EITHER the portal's own change row or the synthetic
    // anchor, depending on whether the capture produced one — both carry the same
    // rawDiff, and a roadmap change without it is a plain lexical signal with no
    // block, which is what the `null` return says.
    if (sourceType === "roadmap" || sourceType === "roadmap_shift") {
      return await roadmapFacts(monitorId, new Date(detectedAt));
    }
    if (sourceType === "integration_catalog") {
      return await integrationFacts(competitorId, monitorId, new Date(detectedAt));
    }
    // Reads the change's own rawDiff for the same reason integrations do: the
    // monthly scan records every tech at once, so a window would name them all.
    if (sourceType === "tech_stack") {
      return await techStackFacts(competitorId, monitorId, new Date(detectedAt));
    }
    const window = await attributionWindow(monitorId, new Date(detectedAt));
    if (sourceType === "homepage") {
      return await positioningFacts(competitorId, monitorId, new Date(detectedAt), window);
    }
    if (sourceType === "jobs") return await hiringFacts(competitorId, window);
    if (sourceType === "job_facts") return await jobFactsFacts(competitorId, window);
    if (sourceType === "changelog") return await changelogFacts(competitorId, window);
    if (REVIEW_SOURCES.has(sourceType ?? "")) return await reviewFacts(competitorId, window);
    return await pricingFacts(competitorId, window);
  } catch {
    return null;
  }
}
