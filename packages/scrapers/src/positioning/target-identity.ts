import { COMMON_WORD_BRANDS, hostOf, namesBrand, normalizeBrand, type SelfIdentity } from "../content/named-you";
import { classifyComparisonUrl, slugMentionsBrand } from "../sitemap/parse";
import { comparisonTargetsFromUrl } from "./comparison-targets";

/**
 * Who a comparison target actually IS (Positioning Intelligence v2 P2).
 *
 * Two questions, and they fail in opposite directions, which is why they are two
 * functions and not one:
 *
 *  1. IS THIS TARGET THE READER? A `/vs/outrival` page on a competitor's site is
 *     already a critical alert from the comparison_page detector, and the reader's
 *     own product must never also be filed as a rival OF that competitor. The
 *     expensive mistake here is a MISS, so this is deliberately the broader test.
 *  2. IS THIS TARGET A COMPETITOR WE TRACK? This is the "who names them" cross
 *     reference, and the expensive mistake is a FALSE match: claiming Crayon named
 *     the workspace's rival "Flow" because a page said "flow". So this is the
 *     narrow test — the Content P2 rule, domain-strong or brand at word boundaries,
 *     with the common-word stoplist doing exactly the job it was written for.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** How a target was resolved. Both are evidence; neither is a guess. */
export type TargetMatchKind = "domain" | "brand";

/** The shape both questions read: what a registry row holds about a target. */
export interface TargetIdentity {
  nameNormalized: string;
  displayName: string;
  /** Filled only when a slug WAS a domain. Never inferred from a name. */
  namedDomain: string | null;
  /** The page that named them — the only text either question is allowed to read. */
  evidenceUrl: string;
}

/** "crayon.co" and "app.crayon.co" are one company; "crayonx.co" is not. */
function sameHost(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().replace(/^www\./, "");
  const y = b.toLowerCase().replace(/^www\./, "");
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * Does this target name the workspace's own product?
 *
 * Three ways, any one of which is enough:
 *
 *  - the slug was a domain the workspace owns;
 *  - the name IS one of the workspace's brands (word boundaries, Content P2);
 *  - the URL PATH carries a self brand at all — the exact predicate the critical
 *    escalation uses. This last one looks redundant and is not: `slugMentionsBrand`
 *    is a substring test with no stoplist, so it catches cases the word-boundary
 *    rule does not, and any gap between the two would be a page that goes out as a
 *    "competitor is attacking you" critical AND files the reader as a rival of the
 *    company attacking them. The two must never disagree.
 *
 * The common-word stoplist deliberately does NOT gate this. It exists to stop a
 * sentence ("our workflow is linear") from paging a workspace called Linear; a slug
 * under `/vs/` is a product name by construction, and applying the stoplist here
 * would quietly file the reader's own product in the market map.
 */
export function targetIsSelf(target: TargetIdentity, self: SelfIdentity): boolean {
  if (target.namedDomain && self.domains.some((d) => sameHost(target.namedDomain, d))) return true;

  const key = normalizeBrand(target.displayName);
  for (const brand of self.brands) {
    const brandKey = normalizeBrand(brand);
    if (brandKey.length >= 3 && brandKey === key) return true;
    if (slugMentionsBrand(target.evidenceUrl, brand)) return true;
  }
  return false;
}

/** A competitor as the cross-reference needs to recognise it. */
export interface TrackedIdentity {
  name: string;
  url: string | null;
}

/**
 * Is this target the company that PUBLISHED the page?
 *
 * `/compare/crayon-vs-klue` on crayon.co names two companies and one of them is the
 * publisher, so without this the map would say "Crayon competes with Crayon" on the
 * most ordinary comparison URL shape there is.
 *
 * Narrow on purpose — exact name or domain, never the substring test `targetIsSelf`
 * uses. That one is deliberately broad because a miss there is the reader's own
 * product landing in the map; a false positive HERE is the opposite failure, and a
 * substring would make a competitor called Rival silently swallow every page they
 * publish against Rivalytics.
 */
export function targetIsOwner(target: TargetIdentity, owner: TrackedIdentity): boolean {
  if (target.namedDomain && sameHost(target.namedDomain, hostOf(owner.url))) return true;
  const key = normalizeBrand(owner.name);
  return key.length >= 3 && key === normalizeBrand(target.displayName);
}

/**
 * Does this target refer to a competitor the workspace tracks?
 *
 * Domain first, because a domain is not a word. Then the brand at word boundaries —
 * and a brand that is also an ordinary EN/FR word needs the domain, or every rival
 * called "Flow" would be credited with every `/compare/flow` page on the internet.
 */
export function matchTrackedCompetitor(
  target: TargetIdentity,
  competitor: TrackedIdentity,
): TargetMatchKind | null {
  const host = hostOf(competitor.url);
  if (target.namedDomain && sameHost(target.namedDomain, host)) return "domain";

  const key = normalizeBrand(competitor.name);
  if (key.length < 3) return null;
  if (key !== normalizeBrand(target.displayName)) return null;
  if (COMMON_WORD_BRANDS.has(key)) return null; // needs the domain, and it wasn't there
  // Both sides have to agree the name is really there: the registry key is
  // normalised, so "flowapp" and "flow app" collapse together, and this is what
  // stops the collapse from inventing a match the page never wrote.
  return namesBrand(target.displayName, competitor.name) ? "brand" : null;
}

/**
 * Which signal owns a newly-published comparison page.
 *
 * A `/vs/` page appearing in a sitemap used to have exactly one answer: the
 * deterministic `content` signal from the sitemap detector, critical when the slug
 * named the reader and high otherwise. P2 adds a second, better answer for the
 * "otherwise" case — `new_comparison_target` says WHO ("a front against Klue")
 * where the old one could only say "a comparison page appeared" — so the two have
 * to divide the pages between them rather than both fire.
 *
 *  - `attacks_you`   the slug names the reader. The deterministic CRITICAL, and the
 *                    one urgent case. Unchanged by this phase, and the reader never
 *                    enters the market map.
 *  - `market_map`    the slug names somebody else we can read. The registry takes
 *                    it and announces it once, per target, for life.
 *  - `unnamed_page`  a comparison page whose slug names nobody: a bare `/compare`
 *                    hub, a generic slug. The market map has nothing to say about
 *                    it, so it keeps the generic signal — without this it would
 *                    appear and go out silently.
 *
 * Null when the URL is not a comparison page at all.
 */
export type ComparisonRoute = "attacks_you" | "market_map" | "unnamed_page";

export function routeComparisonUrl(
  url: string,
  orgBrands: (string | null | undefined)[],
): ComparisonRoute | null {
  const decision = classifyComparisonUrl(url, orgBrands);
  if (!decision) return null;
  if (decision.targetsOrg) return "attacks_you";
  return comparisonTargetsFromUrl(url).length > 0 ? "market_map" : "unnamed_page";
}
