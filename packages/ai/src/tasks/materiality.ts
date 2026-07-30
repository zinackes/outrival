import { z } from "zod";
import type { SignalSeverity } from "@outrival/shared";

// Materiality → severity, decided in TypeScript rather than by the model.
//
// Before this module the classifier picked a severity band directly from a prose
// rubric, which made the single most consequential output of the pipeline (a
// "critical" pages the customer within minutes, bypassing every moderation layer)
// a free-form model judgement that drifted with the provider, the temperature and
// the phrasing of the diff. The model now answers three narrow, observable
// questions and NEVER names a band; the band is this file's arithmetic, so it is
// reproducible, unit-testable at its edges, and reviewable as a diff.
//
// The model still decides the CATEGORY (a semantic call it is good at) — only the
// severity is taken away from it.

export const MaterialitySchema = z.object({
  /**
   * 0 — nothing a buyer or the user would act on (rewording, cosmetics).
   * 1 — worth knowing; changes no decision on its own.
   * 2 — changes how the user should position, price or sell.
   * 3 — a direct threat to, or opening for, the user's own revenue/positioning.
   */
  decision_impact: z.number().int().min(0).max(3),
  /**
   * 0 — fine in the Monday digest.
   * 1 — this week.
   * 2 — in the next couple of days.
   * 3 — the useful reaction window is measured in days, acting late loses ground.
   */
  urgency: z.number().int().min(0).max(3),
  /**
   * 0 — contradicted by the other surfaces, or the "change" looks like a capture
   *     artifact of our own scraper (anti-bot page, error interstitial).
   * 1 — this one surface shows it (the NORMAL case for a single change).
   * 2 — a second independent surface agrees.
   * 3 — three or more independent surfaces agree.
   */
  corroboration: z.number().int().min(0).max(3),
});

export type Materiality = z.infer<typeof MaterialitySchema>;

/** Persisted shape on `signals.materiality` (camelCase, unlike the prompt JSON). */
export interface MaterialityScores {
  decisionImpact: number;
  urgency: number;
  corroboration: number;
}

export function toMaterialityScores(m: Materiality): MaterialityScores {
  return {
    decisionImpact: m.decision_impact,
    urgency: m.urgency,
    corroboration: m.corroboration,
  };
}

const BANDS = ["low", "medium", "high", "critical"] as const;

function shift(severity: SignalSeverity, delta: number): SignalSeverity {
  const i = BANDS.indexOf(severity as (typeof BANDS)[number]);
  const next = Math.min(BANDS.length - 1, Math.max(0, i + delta));
  return BANDS[next]!;
}

/**
 * The mapping table. Two stages: `decision_impact` × `urgency` set the base band,
 * then `corroboration` modulates it.
 *
 *   base
 *     d=3 and u=3          → critical   (mirrors the old rubric's two-part test:
 *                                        direct threat AND a days-long window)
 *     d=3, or d=2 and u>=2 → high
 *     d>=1                 → medium
 *     d=0                  → low
 *
 *   modulator
 *     c=0        → one band down (floor "low"). c=0 means the surfaces disagree or
 *                  the diff smells like our own scraper's error page.
 *     c>=2, d>=2 → one band up, but never INTO "critical".
 *
 * The promotion cap is deliberate: corroboration must not open a second route to
 * paging a customer. Only critical bypasses notification moderation, and the only
 * way to reach it stays d=3 & u=3. In practice the promotion is reachable from
 * "medium" alone (base medium with d>=2 means u<2), i.e. exactly the case
 * "moderate impact, no rush, but three surfaces confirm it".
 */
/** Stage one: the band decision_impact × urgency set, before corroboration. */
function baseBand(m: Materiality): SignalSeverity {
  const { decision_impact: d, urgency: u } = m;
  if (d === 3 && u === 3) return "critical";
  if (d === 3 || (d === 2 && u >= 2)) return "high";
  if (d >= 1) return "medium";
  return "low";
}

/** Whether corroboration moved the base band, and which way. */
function modulation(m: Materiality): "down" | "up" | null {
  const { decision_impact: d, corroboration: c } = m;
  if (c === 0) return "down";
  // Promote only below "high" → a promotion can never produce "critical".
  if (c >= 2 && d >= 2 && BANDS.indexOf(baseBand(m)) < BANDS.indexOf("high")) {
    return "up";
  }
  return null;
}

export function severityFromMateriality(m: Materiality): SignalSeverity {
  const severity = baseBand(m);
  const mod = modulation(m);
  if (mod === "down") return shift(severity, -1);
  if (mod === "up") return shift(severity, 1);
  return severity;
}

/**
 * Why the band is the band, in one or two sentences, for the reader.
 *
 * It lives beside the table and reads the SAME two helpers the band itself is
 * computed from, because an explanation kept anywhere else drifts from the rule it
 * describes, and a confidently wrong account of a deterministic rule is worse than
 * showing the reader nothing. Written for someone who has the three scores in
 * front of them, so it says what the numbers MEANT, not what they were.
 */
export function explainMateriality(m: Materiality): string {
  const { decision_impact: d, urgency: u } = m;

  let base: string;
  if (d === 3 && u === 3) {
    base =
      "Both decision impact and urgency are at their maximum, which is the only route to critical.";
  } else if (d === 3 || (d === 2 && u >= 2)) {
    base = "High decision impact, and the window to react is short.";
  } else if (d >= 1) {
    base =
      u >= 2
        ? "Worth reacting to soon, but it does not change a buying decision on its own."
        : "Worth knowing, and it does not change a buying decision on its own.";
  } else {
    base = "Nothing here changes how anyone buys, prices or positions.";
  }

  const mod = modulation(m);
  if (mod === "down") {
    base +=
      " The surfaces disagree, or the change looks like a capture artifact, so the band drops one step.";
  } else if (mod === "up") {
    base +=
      " Several independent surfaces confirm it, so the band rises one step. Corroboration alone can never reach critical.";
  }
  return base;
}

/**
 * `is_significant` is no longer a separate model judgement that could contradict
 * the severity it shipped with (the classifier used to return, say, low +
 * is_significant true). It is the same number: anything a buyer would act on at
 * all scores decision_impact >= 1.
 */
export function isSignificantFromMateriality(m: Materiality): boolean {
  return m.decision_impact >= 1;
}

// A partnership that ships a product integration is materially different from a
// logo swap on a partners page, and a C-level change is materially different from
// a director hire — but both distinctions are visible in the text the classifier
// already returns, so they cost no extra tokens to detect. Same deterministic
// spirit as severity-guard.ts's PRICE_TOKEN: a regex over the evidence, with the
// SAFE direction (the lower floor) as the fallback when it doesn't match.
const C_LEVEL =
  /\b(ceo|cto|cfo|coo|cmo|cro|ciso|cpo|chief [a-z]+ officer|president|co-?founder|board member|board of directors)\b/i;
const PRODUCT_INTEGRATION =
  /\b(integrat\w*|api|connector|native|embed\w*|plug-?in|sdk|marketplace|interoperab\w*)\b/i;

/**
 * Per-category severity FLOORS for the wave-2 categories. Raise-only: a category
 * floor can lift a band the materiality scores under-rated, never lower one they
 * rated higher. The six legacy categories are deliberately absent — their severity
 * distribution is the one the labelled eval (eval/severity-eval.ts) measures, and
 * flooring them would move that baseline in the same change.
 *
 * Only ever called on the AI classification path. Deterministically synthesized
 * classifications (Hacker News, wellknown/llms.txt, sitemap comparison pages,
 * pricing transitions) build their Classification literally in the worker and
 * keep their forced severity untouched.
 */
export function applyCategoryFloor(
  category: string,
  severity: SignalSeverity,
  evidence: string,
): SignalSeverity {
  let floor: SignalSeverity | null = null;
  switch (category) {
    case "ma":
      // An acquisition of, or by, a tracked competitor redraws the board. This is
      // the one wave-2 category that can page: it is also added to
      // severity-guard.ts's critical allowlist so the floor survives the guard.
      floor = "critical";
      break;
    case "security_compliance":
      floor = "high";
      break;
    case "partnerships":
      floor = PRODUCT_INTEGRATION.test(evidence) ? "high" : "medium";
      break;
    case "leadership":
      floor = C_LEVEL.test(evidence) ? "high" : "medium";
      break;
    case "ads":
      floor = "medium";
      break;
    case "api_developer":
      // Unreachable on this path today: api_developer is kept OUT of the classify
      // prompt, so the model never picks it, and the deterministic llms.txt signal
      // that does use it is synthesized in the worker (forced "low") and never
      // reaches this function. Listed so the table is complete if that changes.
      floor = "medium";
      break;
    default:
      return severity;
  }
  return BANDS.indexOf(severity) >= BANDS.indexOf(floor) ? severity : floor;
}

/** The whole severity decision, in one call: scores → band → category floor. */
export function resolveSeverity(
  category: string,
  m: Materiality,
  evidence: string,
): SignalSeverity {
  return applyCategoryFloor(category, severityFromMateriality(m), evidence);
}
