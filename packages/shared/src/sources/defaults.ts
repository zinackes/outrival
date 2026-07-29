import type { SourceType, MonitorFrequency } from "../constants/sources";
import { planAllowsMonitorSource, type Plan } from "../constants/plans";

/**
 * Which sources a new competitor starts with.
 *
 * Adding a competitor used to seed exactly three user-facing sources (homepage,
 * pricing, blog) plus the internal anchors. Everything else — hiring above all —
 * had to be turned on by hand, per competitor, which is the one chore that scales
 * with the size of the workspace instead of shrinking with it.
 *
 * The set below is the DEFAULT, not a fixed list: an org can narrow or widen it
 * (organizations.default_sources), and plan gating is applied on top, so a free
 * workspace keeps exactly today's behaviour.
 */

/**
 * The homepage is not negotiable. It anchors platform detection, the self/competitor
 * profile extraction, the pricing-page discovery and the visual diff — dropping it
 * would quietly disable half the pipeline, so it is re-added even if an org's stored
 * set omits it.
 */
export const REQUIRED_SEED_SOURCE: SourceType = "homepage";

/**
 * Sources that can be seeded blind, i.e. that need no per-competitor input from the
 * user and no evidence from detection:
 *   - homepage/pricing/blog — today's baseline, discovered from the competitor URL;
 *   - jobs — the careers page / ATS board is auto-discovered from the site;
 *   - docs — the docs root is auto-discovered (subdomain → conventional path → link);
 *   - roadmap — the Canny / ProductBoard portal is auto-discovered.
 *
 * Deliberately absent:
 *   - status / changelog — platform detection already seeds these WITH the resolved
 *     URL when the surface exists (seedDetectedSources), which beats a blind guess;
 *   - appstore_reviews / github_repo — the enable route requires an explicit URL,
 *     so a seeded row could only ever fail;
 *   - trustpilot_public — needs TRUSTPILOT_API_KEY, an env the seeding path has no
 *     business branching on;
 *   - custom — its own flow, several per competitor, quota'd.
 */
export const SEEDABLE_SOURCES: readonly SourceType[] = [
  "homepage",
  "pricing",
  "blog",
  "jobs",
  "docs",
  "roadmap",
];

/**
 * The default set when an org has never customised it. It is the full seedable list:
 * the plan filter below is what keeps it honest (free allows only homepage/pricing/
 * blog, so free workspaces see no change at all, while a paid workspace gets the
 * sources it is already paying for without a per-competitor chore).
 */
export const DEFAULT_SEED_SOURCES: readonly SourceType[] = SEEDABLE_SOURCES;

/**
 * Cadence a source is SEEDED at (the enable route has its own default, deliberately
 * left alone). Anything not named here is weekly — the safe side for a source that
 * nobody explicitly asked for. Slow-moving surfaces stay weekly on purpose: docs move
 * on release cycles and a run costs a sitemap walk plus a capped batch of page
 * fetches, and a roadmap portal moves on sprint cadence with vote bands built to
 * ignore day-to-day drift.
 */
const SEED_FREQUENCIES: Partial<Record<SourceType, MonitorFrequency>> = {
  homepage: "daily",
  pricing: "daily",
  jobs: "daily",
};

export function seedFrequencyFor(source: SourceType): MonitorFrequency {
  return SEED_FREQUENCIES[source] ?? "weekly";
}

/**
 * The sources to actually create for a competitor: the org's stored preference (or
 * the built-in default), narrowed to what can be seeded blind and to what the plan
 * allows, with the homepage always present. Order follows SEEDABLE_SOURCES so the
 * seeded rows read the same everywhere.
 */
export function resolveSeedSources(
  plan: Plan,
  orgDefaults: readonly SourceType[] | null | undefined,
): SourceType[] {
  const wanted = new Set<SourceType>(orgDefaults ?? DEFAULT_SEED_SOURCES);
  wanted.add(REQUIRED_SEED_SOURCE);
  return SEEDABLE_SOURCES.filter((s) => wanted.has(s) && planAllowsMonitorSource(plan, s));
}

/**
 * Sources the org could add to its default set at its CURRENT plan — what the
 * settings screen offers and what the upgrade banner counts. A source above the plan
 * is not offered here; it reappears on its own once the plan includes it, which is
 * exactly the moment the banner has something to say.
 */
export function seedableSourcesForPlan(plan: Plan): SourceType[] {
  return SEEDABLE_SOURCES.filter((s) => planAllowsMonitorSource(plan, s));
}
