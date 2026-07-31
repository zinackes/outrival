/**
 * Which control on a pricing page is the QUANTITY (Pricing Intelligence P4).
 *
 * Pure: the browser serialises every plausible control into a `ControlCandidate`
 * (see probe.ts), and this module picks one — or refuses. No DOM, no Playwright,
 * so the ranking rules are unit-tested against fixtures instead of against a live
 * page.
 *
 * The refusal that matters most is `unit_unresolved`. A slider whose label we
 * cannot map onto a canonical meter (unit-alias) is a slider we would be moving
 * blind: the cost it produces would be stored against a meter we guessed, and a
 * guessed meter compared against a known one is exactly the arithmetic the whole
 * unit catalog exists to prevent. Unknown is not a unit — the probe stops.
 */

import { resolveMeterUnit } from "@outrival/shared";
import type { CalculatorControlKind } from "@outrival/shared";

export interface ControlCandidate {
  /** Document-relative CSS selector built in-page (id → #id, else a nth-child path). */
  selector: string;
  kind: CalculatorControlKind;
  /**
   * Everything the page says about this control, concatenated: aria-label, its
   * <label>, name/id, placeholder, and the nearest heading/text before it. The
   * unit resolver reads this whole string — a slider is labelled in one of those
   * five places depending on the design system, never reliably in one of them.
   */
  label: string;
  min: number | null;
  max: number | null;
  step: number | null;
  /** Numeric option values, for a <select> quantity picker. */
  options: number[];
  /**
   * DOM distance (hops through the common ancestor) to the nearest element whose
   * text carries a price token. A quantity control sits near the number it
   * moves; a newsletter form's "number of employees" field does not.
   */
  priceDistance: number;
}

export interface PickedControl {
  selector: string;
  kind: CalculatorControlKind;
  /** Canonical meter slug — never the page's raw wording. */
  unit: string;
  min: number | null;
  max: number | null;
  step: number | null;
  options: number[];
}

export type ControlPick =
  | { ok: true; control: PickedControl }
  | { ok: false; reason: "no_controls" | "unit_unresolved" };

/** Past this many DOM hops from any price, a control is part of some other form. */
export const MAX_PRICE_DISTANCE = 12;

/**
 * The quantity control, or why there isn't one.
 *
 * Ranked, not filtered-to-one: several controls on a calculator resolve to a
 * canonical meter (seats AND events AND storage). The one nearest the price is
 * the one the displayed total actually reacts to most directly, and a tie is
 * broken toward the control with the widest range — the one that can still
 * answer at 1,000,000 units.
 */
export function pickControl(candidates: ControlCandidate[]): ControlPick {
  const usable = candidates.filter(
    (c) => c.priceDistance <= MAX_PRICE_DISTANCE && (c.kind !== "select" || c.options.length > 1),
  );
  if (usable.length === 0) return { ok: false, reason: "no_controls" };

  const resolved = usable
    .map((c) => ({ candidate: c, meter: resolveMeterUnit(c.label) }))
    .filter((x): x is { candidate: ControlCandidate; meter: { unit: string; canonical: true } } =>
      Boolean(x.meter?.canonical),
    );
  if (resolved.length === 0) return { ok: false, reason: "unit_unresolved" };

  resolved.sort((a, b) => {
    if (a.candidate.priceDistance !== b.candidate.priceDistance) {
      return a.candidate.priceDistance - b.candidate.priceDistance;
    }
    return reach(b.candidate) - reach(a.candidate);
  });

  const { candidate, meter } = resolved[0]!;
  return {
    ok: true,
    control: {
      selector: candidate.selector,
      kind: candidate.kind,
      unit: meter.unit,
      min: candidate.min,
      max: candidate.max,
      step: candidate.step,
      options: candidate.options,
    },
  };
}

/** The largest quantity a control can express (0 when it doesn't say). */
function reach(c: ControlCandidate): number {
  if (c.options.length > 0) return Math.max(...c.options);
  return c.max ?? 0;
}

/**
 * The quantities this control can actually be set to, out of the ones we were
 * asked to measure.
 *
 * A slider that stops at 50,000 has no opinion about 1,000,000 — that volume is
 * outside what the competitor's calculator answers, not a failed measurement. It
 * is dropped from the run rather than approximated to the slider's maximum,
 * which would store "what 1M costs" against the price of 50k.
 *
 * A `select` answers only at its own option values, so a requested volume is kept
 * only when the list holds it exactly.
 */
export function reachableQuantities(control: PickedControl, wanted: number[]): number[] {
  return wanted.filter((qty) => {
    if (!Number.isFinite(qty) || qty <= 0) return false;
    if (control.options.length > 0) return control.options.includes(qty);
    if (control.min != null && qty < control.min) return false;
    if (control.max != null && qty > control.max) return false;
    // A stepped slider that cannot land exactly on the volume would be measured
    // at whatever the browser snaps to — a different question than the one asked.
    if (control.step != null && control.step > 1) {
      const base = control.min ?? 0;
      const offset = qty - base;
      if (Math.abs(offset % control.step) > 1e-9) return false;
    }
    return true;
  });
}
