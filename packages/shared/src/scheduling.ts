import type { MonitorFrequency, SourceType } from "./constants/sources";
import { PLAN_LIMITS, clampFrequencyToPlan, planIncludesFrequency, type Plan } from "./constants/plans";
import { isAutomaticSource } from "./sources/catalog";
import { seedFrequencyFor } from "./sources/defaults";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const BASE_INTERVAL_MS: Record<MonitorFrequency, number> = {
  realtime: 1 * HOUR,
  daily: 24 * HOUR,
  weekly: 7 * DAY,
};

const MAX_INTERVAL_MS: Record<MonitorFrequency, number> = {
  realtime: 12 * HOUR,
  daily: 5 * DAY,
  weekly: 30 * DAY,
};

function stalenessMultiplier(daysStable: number): number {
  if (daysStable < 14) return 1;
  if (daysStable < 45) return 2;
  if (daysStable < 90) return 3;
  return 4;
}

export function computeNextRun(
  frequency: MonitorFrequency,
  lastChangedAt: Date | null,
  createdAt: Date,
  now: Date = new Date(),
): Date {
  const reference = lastChangedAt ?? createdAt;
  const daysStable = (now.getTime() - reference.getTime()) / DAY;
  const interval = Math.min(
    BASE_INTERVAL_MS[frequency] * stalenessMultiplier(daysStable),
    MAX_INTERVAL_MS[frequency],
  );
  return new Date(now.getTime() + interval);
}

// ---- Always-on cadence (OUT-11) ---------------------------------------------
// The always-on sources (AUTOMATIC_SOURCES) are seeded weekly and were read-only
// forever. Pro and Business can now speed them up. Three rules bound that: what the
// SOURCE can take, what the PLAN buys, and what a downgrade takes back.

/**
 * The cadences an always-on source accepts, narrower than MONITOR_FREQUENCIES on
 * purpose: `realtime` is an HOURLY poll (see BASE_INTERVAL_MS) and every one of these
 * sources reads an endpoint nobody pays us for per competitor — Google News RSS, the
 * HN Algolia index, a channel's videos.xml. Hourly × 50 competitors is abuse of
 * someone else's service dressed up as a plan perk, so the ceiling is daily and the
 * floor stays the weekly seed.
 */
export const ALWAYS_ON_FREQUENCIES: readonly MonitorFrequency[] = ["daily", "weekly"];

/**
 * Always-on sources whose cadence is fixed at the seed on EVERY tier.
 *
 * `subdomains` reads Certificate Transparency through crt.sh, which is slow, shared and
 * 429s under a daily × N-competitor load. That is why both creation paths seed it weekly
 * with the reason written down (`competitors.ts` POST, `onboarding.ts`), and selling the
 * knob would quietly undo that decision: 15 competitors on pro is 15 daily CT lookups
 * where the provider already refused 7× less traffic.
 */
const CADENCE_LOCKED_SOURCES: readonly SourceType[] = ["subdomains"];

/**
 * The cadences a given always-on source accepts, before any plan gate. A locked source
 * reports exactly its seed, so callers can render "this is a fact" instead of a control
 * with one position.
 */
export function alwaysOnFrequenciesForSource(source: SourceType): readonly MonitorFrequency[] {
  if (CADENCE_LOCKED_SOURCES.includes(source)) return [seedFrequencyFor(source)];
  return ALWAYS_ON_FREQUENCIES;
}

/**
 * The cadences `plan` may pick for `source`. Empty means the plan cannot configure the
 * always-on block at all, which is the state every tier below pro is in; a single value
 * means the SOURCE is fixed and no upgrade changes that.
 *
 * Intersected with the plan's own `allowedFrequencies` so this can never hand out a
 * cadence the frequency gate would refuse a line later.
 */
export function alwaysOnFrequenciesFor(
  plan: Plan,
  source: SourceType,
): readonly MonitorFrequency[] {
  if (!PLAN_LIMITS[plan].features.alwaysOnCadence) return [];
  return alwaysOnFrequenciesForSource(source).filter((f) => planIncludesFrequency(plan, f));
}

/**
 * The cadence a monitor actually reschedules at, for the org's CURRENT plan.
 *
 * Same soft, reversible shape as `clampFrequencyToPlan`, which it wraps: the stored
 * `monitors.frequency` is never mutated, so re-upgrading restores the full cadence on
 * the next run. The always-on branch exists because a downgrade from pro to starter
 * would otherwise keep a sped-up anchor running daily — starter allows `daily` for the
 * sources it pays for, and the frequency gate alone cannot tell the two apart. It also
 * catches a stored value the SOURCE no longer accepts, so adding one to
 * CADENCE_LOCKED_SOURCES takes effect on the next run instead of needing a backfill.
 */
export function effectiveFrequencyFor(
  plan: Plan,
  sourceType: SourceType,
  frequency: MonitorFrequency,
): MonitorFrequency {
  if (
    isAutomaticSource(sourceType) &&
    !alwaysOnFrequenciesFor(plan, sourceType).includes(frequency)
  ) {
    return seedFrequencyFor(sourceType);
  }
  return clampFrequencyToPlan(plan, frequency);
}
