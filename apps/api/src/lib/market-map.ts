import { and, eq, isNull, like, ne, or } from "drizzle-orm";
import { db, competitors, namedCompetitors } from "@outrival/db";
import { normalizeCustomerName } from "@outrival/shared";
import {
  isPageSource,
  matchTrackedCompetitor,
  type TargetMatchKind,
} from "@outrival/scrapers/positioning";

/**
 * The market map: who a competitor attacks, and who attacks them
 * (Positioning Intelligence v2 P2).
 *
 * Two directions of the same table, and only the second one is interesting to get
 * right. "Who they attack" is a read of their own rows. "Who names them" is a
 * CROSS REFERENCE, and a cross reference is where a workspace boundary gets lost:
 * every row in `named_competitors` belongs to some org's competitor, and a query
 * that matched on the name alone would answer this user with another company's
 * intelligence.
 *
 * So the org filter lives in the WHERE clause, on the OWNER of the row, and never
 * in a `.filter()` afterwards. A post-filter is one refactor away from being
 * dropped, and the failure is silent: the shape of the answer does not change, only
 * whose data is in it.
 */

/** One rival a competitor points at, folded across every page that names them. */
export interface NamedTarget {
  name: string;
  /** 'vs_page' | 'alternatives_page' | 'blog' | 'docs', deduped. */
  sources: string[];
  /** The pages that name them, newest evidence first. */
  evidenceUrls: string[];
  /** "YYYY-MM-DD" — when WE first saw them named, the only date a slug gives us. */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** True once a `new_comparison_target` has announced them. */
  announced: boolean;
}

/**
 * The two halves of "who they attack", which are NOT the same claim.
 *
 * `targets` is a front: they built a `/vs/` or `/alternatives/` page, and the URL is
 * the evidence. `mentions` is a name a post or a doc page wrote — worth showing,
 * never worth stating as "they line up against them". Folding the two into one list
 * is what let a container registry be reported as competing with an airline and a
 * streaming service, because its launch posts named its customers.
 */
export interface MarketMapTargets {
  targets: NamedTarget[];
  mentions: NamedTarget[];
}

/**
 * Split folded targets on their evidence.
 *
 * A target holding BOTH kinds is a front: the page is the stronger claim, and the
 * post that also names them is extra evidence for it rather than a second entry.
 */
export function splitByEvidence(targets: ReadonlyArray<NamedTarget>): MarketMapTargets {
  const out: MarketMapTargets = { targets: [], mentions: [] };
  for (const t of targets) {
    (t.sources.some(isPageSource) ? out.targets : out.mentions).push(t);
  }
  return out;
}

/** Another competitor in THIS workspace that names the one being looked at. */
export interface NamedByEntry {
  competitorId: string;
  competitorName: string;
  /** How the match was established — a domain stands on its own, a brand does not. */
  matchedOn: TargetMatchKind;
  sources: string[];
  evidenceUrls: string[];
  firstSeenAt: string | null;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** Who this competitor points at. Their own rows, folded per target. */
export async function namedTargets(competitorId: string): Promise<NamedTarget[]> {
  const rows = await db
    .select({
      nameNormalized: namedCompetitors.nameNormalized,
      displayName: namedCompetitors.displayName,
      source: namedCompetitors.source,
      evidenceUrl: namedCompetitors.evidenceUrl,
      firstSeenAt: namedCompetitors.firstSeenAt,
      lastSeenAt: namedCompetitors.lastSeenAt,
      signalledAt: namedCompetitors.signalledAt,
    })
    .from(namedCompetitors)
    .where(eq(namedCompetitors.competitorId, competitorId))
    .orderBy(namedCompetitors.firstSeenAt);

  const byName = new Map<string, NamedTarget>();
  for (const row of rows) {
    const held = byName.get(row.nameNormalized);
    if (!held) {
      byName.set(row.nameNormalized, {
        name: row.displayName,
        sources: [row.source],
        evidenceUrls: row.evidenceUrl ? [row.evidenceUrl] : [],
        firstSeenAt: iso(row.firstSeenAt),
        lastSeenAt: iso(row.lastSeenAt),
        announced: row.signalledAt !== null,
      });
      continue;
    }
    if (!held.sources.includes(row.source)) held.sources.push(row.source);
    if (row.evidenceUrl && !held.evidenceUrls.includes(row.evidenceUrl)) {
      held.evidenceUrls.push(row.evidenceUrl);
    }
    if (row.lastSeenAt && (!held.lastSeenAt || iso(row.lastSeenAt)! > held.lastSeenAt)) {
      held.lastSeenAt = iso(row.lastSeenAt);
    }
    held.announced ||= row.signalledAt !== null;
  }
  return [...byName.values()];
}

/**
 * Which OTHER competitors of THIS workspace name this one.
 *
 * The org filter is on `competitors.org_id` inside the query, joined from the row's
 * owner — this is decision 2 of the card ("intra-workspace STRICT") expressed as a
 * WHERE clause rather than as a convention. `named-by-scoping.test.ts` seeds two
 * workspaces holding the same rival and breaks if a foreign row ever comes out.
 *
 * The SQL narrows on the registry key (or on the domain, when a slug carried one);
 * `matchTrackedCompetitor` then confirms it, which is where the common-word
 * stoplist applies — without it every `/compare/flow` page on the internet would be
 * reported as naming a workspace's rival called Flow.
 */
export async function namedBy(args: {
  competitorId: string;
  orgId: string;
  name: string;
  url: string | null;
}): Promise<NamedByEntry[]> {
  const key = normalizeCustomerName(args.name);
  if (key.length < 3) return [];
  let host: string | null = null;
  try {
    host = args.url ? new URL(args.url).hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    host = null;
  }

  const nameOrDomain = host
    ? or(
        eq(namedCompetitors.nameNormalized, key),
        eq(namedCompetitors.namedDomain, host),
        like(namedCompetitors.namedDomain, `%.${host}`),
      )
    : eq(namedCompetitors.nameNormalized, key);

  const rows = await db
    .select({
      competitorId: competitors.id,
      competitorName: competitors.name,
      displayName: namedCompetitors.displayName,
      nameNormalized: namedCompetitors.nameNormalized,
      namedDomain: namedCompetitors.namedDomain,
      source: namedCompetitors.source,
      evidenceUrl: namedCompetitors.evidenceUrl,
      firstSeenAt: namedCompetitors.firstSeenAt,
    })
    .from(namedCompetitors)
    .innerJoin(competitors, eq(competitors.id, namedCompetitors.competitorId))
    .where(
      and(
        // THE workspace boundary. Not a post-filter, on purpose.
        eq(competitors.orgId, args.orgId),
        isNull(competitors.deletedAt),
        // A competitor naming itself is a page about their own product.
        ne(namedCompetitors.competitorId, args.competitorId),
        nameOrDomain,
      ),
    )
    .orderBy(namedCompetitors.firstSeenAt);

  const byOwner = new Map<string, NamedByEntry>();
  for (const row of rows) {
    const matchedOn = matchTrackedCompetitor(
      {
        nameNormalized: row.nameNormalized,
        displayName: row.displayName,
        namedDomain: row.namedDomain,
        evidenceUrl: row.evidenceUrl ?? "",
      },
      { name: args.name, url: args.url },
    );
    if (!matchedOn) continue;

    const held = byOwner.get(row.competitorId);
    if (!held) {
      byOwner.set(row.competitorId, {
        competitorId: row.competitorId,
        competitorName: row.competitorName,
        matchedOn,
        sources: [row.source],
        evidenceUrls: row.evidenceUrl ? [row.evidenceUrl] : [],
        firstSeenAt: iso(row.firstSeenAt),
      });
      continue;
    }
    if (!held.sources.includes(row.source)) held.sources.push(row.source);
    if (row.evidenceUrl && !held.evidenceUrls.includes(row.evidenceUrl)) {
      held.evidenceUrls.push(row.evidenceUrl);
    }
    // A domain match outranks a brand match: it is the one that stands alone.
    if (matchedOn === "domain") held.matchedOn = "domain";
  }
  return [...byOwner.values()];
}
