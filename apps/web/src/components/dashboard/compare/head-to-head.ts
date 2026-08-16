import type { CompareColumn } from "@/lib/api";
import {
  avgReview,
  displayCurrency,
  engineeringRoles,
  firstClause,
  money,
  openRoles,
  priceReading,
  releasesPerMonth,
  shortAge,
  type Tone,
} from "./derive";

/**
 * The competitor profile's two generated sections (OUT-194): "How you compare" and
 * "How to differentiate".
 *
 * Same material as the compare verdict, read one-to-one instead of across a set. The
 * verdict speaks in set language ("mid-table of the five"), which says nothing on a
 * page about a single competitor, so the readings are recomputed here as a duel.
 *
 * Every line is arithmetic over captured columns, and every line carries the surface
 * it was read from and when. That is the point of the pair: the audit of 2026-08-14
 * found generated prose stating extraction limits as facts, so nothing here is
 * written that cannot name its source. A dimension we hold on only one side produces
 * no comparison rather than a hedged one.
 */

/** The surface a line was read off, and when we last read it. */
export interface Provenance {
  /** Named the way the reader would go and check it: "their pricing page", "G2". */
  source: string;
  /** ISO instant of that capture, or null when the source carries none. */
  at: string | null;
}

/** One dimension, read as you against them. */
export interface ComparisonLine {
  key: string;
  /** Emphasised opening of the line. */
  lead: string;
  /** The rest of the line, plain. */
  rest: string;
  /** Right-aligned reading, yours first. */
  value: string;
  tone: Tone;
  provenance: Provenance;
}

/** One move you can make, and the captured fact that supports it. */
export interface DifferentiationLine {
  key: string;
  /** The move, imperative. */
  action: string;
  /** Why it holds, in the data's own numbers. */
  because: string;
  provenance: Provenance;
}

export interface HeadToHeadReading {
  compare: ComparisonLine[];
  differentiate: DifferentiationLine[];
}

// Below this the two entry prices are the same offer quoted differently, and calling
// one of them cheaper would be noise dressed as a finding.
const PRICE_TIE_RATIO = 0.05;
// A sub-score only counts as their soft spot once it sits this far under their own
// average across the four dimensions.
const WEAK_SUBSCORE_GAP = 0.2;
// Same rule as the release lens: a smaller difference in cadence is arithmetic.
const CADENCE_TIE_RATIO = 0.15;

const SEVERITY_TONE: Record<string, Tone> = { critical: "bad", high: "warn" };

function pricingProvenance(them: CompareColumn): Provenance {
  return { source: "their pricing page", at: them.pricing?.capturedAt ?? null };
}

function hiringProvenance(them: CompareColumn): Provenance {
  return { source: "their jobs board", at: them.hiring?.capturedAt ?? null };
}

/** Their most-reviewed source: the one a reader would quote back at you. */
function loudestReview(them: CompareColumn) {
  return [...them.reviews].sort((a, b) => b.reviewCount - a.reviewCount)[0] ?? null;
}

/**
 * The dimension their own reviewers rate lowest, measured against their other three
 * rather than against an absolute bar. A product rated 4.6 everywhere still has a
 * weakest mark, and that is the one to lead on.
 */
function softSpot(
  sub: { ease: number; support: number; features: number; value: number },
): { label: string; score: number } | null {
  const dims = [
    { label: "ease of use", score: sub.ease },
    { label: "support", score: sub.support },
    { label: "features", score: sub.features },
    { label: "value for money", score: sub.value },
  ].filter((d) => d.score > 0);
  if (dims.length < 2) return null;
  const mean = dims.reduce((s, d) => s + d.score, 0) / dims.length;
  const weakest = [...dims].sort((a, b) => a.score - b.score)[0];
  if (!weakest || mean - weakest.score < WEAK_SUBSCORE_GAP) return null;
  return weakest;
}

export function buildHeadToHead(
  you: CompareColumn,
  them: CompareColumn,
  now = Date.now(),
  rates: Record<string, number> | null = null,
): HeadToHeadReading {
  const compare: ComparisonLine[] = [];
  const differentiate: DifferentiationLine[] = [];

  // ── entry price
  // Read on one currency and one period, like the price lens: a captured €490/yr
  // against a captured $49/mo would name the wrong side cheaper.
  const currency = displayCurrency([you, them], rates);
  const monthlyEntry = (c: CompareColumn): number | null => {
    const r = priceReading(c, rates, currency);
    return r.kind === "band" ? r.entry : null;
  };
  const youEntry = monthlyEntry(you);
  const themEntry = monthlyEntry(them);
  if (youEntry != null && themEntry != null) {
    const prov = pricingProvenance(them);
    const gap = Math.abs(youEntry - themEntry);
    const tie = gap <= Math.max(youEntry, themEntry) * PRICE_TIE_RATIO;
    const pair = `${money(youEntry, currency)} vs ${money(themEntry, currency)}`;
    if (tie) {
      compare.push({
        key: "price",
        lead: "Level at the door",
        rest: `you and ${them.name} open within a rounding error`,
        value: pair,
        tone: "flat",
        provenance: prov,
      });
    } else if (youEntry < themEntry) {
      compare.push({
        key: "price",
        lead: "You open cheaper",
        rest: `by ${money(gap, currency)} a month`,
        value: pair,
        tone: "good",
        provenance: prov,
      });
      differentiate.push({
        key: "price",
        action: "Lead with the entry price",
        because: `you open ${money(gap, currency)} a month under ${them.name}`,
        provenance: prov,
      });
    } else {
      compare.push({
        key: "price",
        lead: "You open dearer",
        rest: `by ${money(gap, currency)} a month`,
        value: pair,
        tone: "bad",
        provenance: prov,
      });
      differentiate.push({
        key: "price",
        action: "Answer the price objection first",
        because: `${them.name} opens ${money(gap, currency)} a month under you`,
        provenance: prov,
      });
    }
  }

  // ── review standing
  // A self-competitor never gets a reviews monitor (patch-12), so there is usually no
  // rating on your side. Their soft spot still stands on its own as material.
  const loudest = loudestReview(them);
  const youAvg = avgReview(you);
  const themAvg = avgReview(them);
  if (youAvg != null && themAvg != null) {
    const prov: Provenance = {
      source: loudest?.source ?? "their review sources",
      at: loudest?.recordedAt ?? null,
    };
    const pair = `${youAvg.toFixed(1)} vs ${themAvg.toFixed(1)}`;
    const diff = youAvg - themAvg;
    if (Math.abs(diff) < 0.1) {
      compare.push({
        key: "rating",
        lead: "Rated level",
        rest: `with ${them.name}`,
        value: pair,
        tone: "flat",
        provenance: prov,
      });
    } else {
      compare.push({
        key: "rating",
        lead: diff > 0 ? "You are rated higher" : "They are rated higher",
        rest: `by ${Math.abs(diff).toFixed(1)} of a point`,
        value: pair,
        tone: diff > 0 ? "good" : "bad",
        provenance: prov,
      });
      if (diff > 0) {
        differentiate.push({
          key: "rating",
          action: "Put the ratings side by side",
          because: `you sit ${Math.abs(diff).toFixed(1)} of a point above ${them.name}`,
          provenance: prov,
        });
      }
    }
  }

  if (loudest?.sub) {
    const weak = softSpot(loudest.sub);
    if (weak) {
      differentiate.push({
        key: "soft-spot",
        action: `Lead on ${weak.label}`,
        because: `${them.name} scores ${weak.score.toFixed(1)} there on ${loudest.source}, its weakest mark`,
        provenance: { source: loudest.source, at: loudest.recordedAt },
      });
    }
  }

  // ── hiring
  const youRoles = openRoles(you);
  const themRoles = openRoles(them);
  if (youRoles != null && themRoles != null && youRoles + themRoles > 0) {
    const prov = hiringProvenance(them);
    const themEng = engineeringRoles(them);
    const rest =
      themEng != null && themEng > 0
        ? `open roles, ${themEng} of theirs in engineering`
        : `open roles across both`;
    compare.push({
      key: "hiring",
      lead:
        themRoles > youRoles
          ? "They are hiring harder"
          : themRoles < youRoles
            ? "You are hiring harder"
            : "Hiring at the same rate",
      rest,
      value: `${youRoles} vs ${themRoles}`,
      tone: themRoles > youRoles ? "warn" : "flat",
      provenance: prov,
    });
  }

  // ── release cadence
  const youShip = releasesPerMonth(you);
  const themShip = releasesPerMonth(them);
  if (youShip != null && themShip != null) {
    // The changelog rows behind the rate carry no single capture instant, so the
    // badge names the surface and stops there rather than dating it wrongly.
    const prov: Provenance = { source: "their changelog", at: null };
    const pair = `${youShip.toFixed(1)} vs ${themShip.toFixed(1)} /mo`;
    const tie = Math.abs(youShip - themShip) <= Math.max(youShip, themShip) * CADENCE_TIE_RATIO;
    if (tie) {
      compare.push({
        key: "shipping",
        lead: "Shipping at the same pace",
        rest: `as ${them.name}`,
        value: pair,
        tone: "flat",
        provenance: prov,
      });
    } else if (youShip > themShip) {
      compare.push({
        key: "shipping",
        lead: "You ship more often",
        rest: `than ${them.name}`,
        value: pair,
        tone: "good",
        provenance: prov,
      });
      differentiate.push({
        key: "shipping",
        action: "Lead with release pace",
        because: `you ship ${youShip.toFixed(1)} a month against their ${themShip.toFixed(1)}`,
        provenance: prov,
      });
    } else {
      compare.push({
        key: "shipping",
        lead: "They ship more often",
        rest: `than you`,
        value: pair,
        tone: "warn",
        provenance: prov,
      });
    }
  }

  // ── their latest move
  const move = them.latestSignal;
  if (move) {
    compare.push({
      key: "moves",
      lead: `${them.name} just moved`,
      rest: firstClause(move.insight),
      value: shortAge(move.createdAt, now),
      tone: SEVERITY_TONE[move.severity] ?? "flat",
      provenance: { source: "the signal feed", at: move.createdAt },
    });
  }

  // What needs attention leads, same order as the compare verdict.
  const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, good: 2, flat: 3 };
  compare.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  return { compare, differentiate };
}
