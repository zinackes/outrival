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
 *   - appstore_reviews — needs a per-competitor URL, so it can't be seeded blind;
 *     it is seeded from DETECTION instead (see DETECTION_SEEDED_SOURCES below);
 *   - github_repo — the enable route requires an explicit URL and nothing discovers
 *     it, so a seeded row could only ever fail;
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
 * Sources that carry a per-competitor URL and are therefore seeded only once
 * DETECTION has produced it — never blind.
 *
 * `appstore_reviews` is the case: the App Store id is not derivable from a domain,
 * so the source used to sit behind a manual paste even though we already read the
 * competitor's store badge off their homepage on every scrape (mobile-apps.ts writes
 * competitors.metadata.mobileApps). The setting below is what the user consents to:
 * "when we find their App Store listing, start reading its reviews".
 *
 * They are org preferences like the blind-seedable ones (same stored column, same
 * settings card), but they never widen `resolveSeedSources` — a competitor with no
 * detected app gets no row at all.
 */
export const DETECTION_SEEDED_SOURCES: readonly SourceType[] = ["appstore_reviews"];

/**
 * Everything the monitoring-defaults setting can offer and store: what can be seeded
 * blind, plus what detection seeds once it has the URL.
 */
export const SELECTABLE_DEFAULT_SOURCES: readonly SourceType[] = [
  ...SEEDABLE_SOURCES,
  ...DETECTION_SEEDED_SOURCES,
];

/**
 * The default set when an org has never customised it. It is the full selectable
 * list: the plan filter below is what keeps it honest (free allows only homepage/
 * pricing/blog, so free workspaces see no change at all, while a paid workspace gets
 * the sources it is already paying for without a per-competitor chore).
 */
export const DEFAULT_SEED_SOURCES: readonly SourceType[] = SELECTABLE_DEFAULT_SOURCES;

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
export function defaultSourcesForPlan(plan: Plan): SourceType[] {
  return SELECTABLE_DEFAULT_SOURCES.filter((s) => planAllowsMonitorSource(plan, s));
}

/**
 * Whether the org wants a DETECTION-seeded source provisioned when detection finds
 * its URL. Same stored preference as the blind-seed set (null = follow the built-in
 * default, i.e. on), and the caller still owns the plan gate — unlike the blind path
 * this one re-runs on every capture, so a source skipped on free is provisioned by
 * itself on the next scrape after an upgrade.
 */
export function wantsDetectedSource(
  source: SourceType,
  orgDefaults: readonly SourceType[] | null | undefined,
): boolean {
  if (!DETECTION_SEEDED_SOURCES.includes(source)) return false;
  return (orgDefaults ?? DEFAULT_SEED_SOURCES).includes(source);
}
