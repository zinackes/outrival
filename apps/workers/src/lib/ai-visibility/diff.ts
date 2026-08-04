// AI Visibility — per-RUN share of voice (docs/ai-visibility.md). Pure functions (no
// DB): turn the raw per-(prompt × subject) rows of ONE run into per-engine share of
// voice.
//
// The run-to-run delta that used to live here was removed in Positioning Intelligence
// v2 P5. It compared the last sweep to the one before it, which mostly measured how
// differently an answer engine answers the same question twice. Signals are now
// computed over 28-day windows in `./shift.ts`, off the same rows.
//
// What remains is the single-run aggregate, which the day-0 onboarding teaser still
// wants: that card is a one-shot taste of a single free sweep, and a window it has no
// history for would leave it with nothing to show.

export interface VisibilityRow {
  competitorId: string;
  engine: string;
  promptId: string;
  mentioned: boolean;
  // The prompt text names this subject. Such a pair is contaminated (naming a brand
  // guarantees it appears), so it is dropped from this subject's organic share-of-voice.
  promptNamed: boolean;
  rank: number | null;
}

// True when the prompt text names the subject brand (word-ish boundary, case-insensitive).
// A "compare X vs Y" prompt names X and Y, so their mention in the answer is seeded, not
// organic — the caller excludes that (prompt, subject) pair from share-of-voice. Kept
// deliberately strict (full-name, bounded) so a short brand name can't false-positive on
// a substring of another word.
export function promptNamesSubject(promptText: string, subjectName: string): boolean {
  const name = subjectName.trim();
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(promptText);
}

export interface SubjectAgg {
  mentions: number;
  sov: number; // share of voice on this engine = mentions / totalPrompts (0..1)
  avgRank: number | null;
}
export interface EngineAgg {
  totalPrompts: number;
  subjects: Map<string, SubjectAgg>; // competitorId → agg
}
export type RunAgg = Map<string, EngineAgg>; // engine → agg

export function aggregate(rows: VisibilityRow[]): RunAgg {
  const byEngine = new Map<
    string,
    {
      prompts: Set<string>;
      // Per subject: the organic prompt set (those NOT naming it) is the SoV denominator,
      // so a subject named by every prompt scores 0 organic rather than an inflated 100%.
      subj: Map<string, { organicPrompts: Set<string>; m: number; rSum: number; rCount: number }>;
    }
  >();
  for (const r of rows) {
    let e = byEngine.get(r.engine);
    if (!e) {
      e = { prompts: new Set(), subj: new Map() };
      byEngine.set(r.engine, e);
    }
    e.prompts.add(r.promptId);
    let s = e.subj.get(r.competitorId);
    if (!s) {
      s = { organicPrompts: new Set(), m: 0, rSum: 0, rCount: 0 };
      e.subj.set(r.competitorId, s);
    }
    // Contaminated pair (the prompt names this subject) → not a valid organic test for it.
    if (r.promptNamed) continue;
    s.organicPrompts.add(r.promptId);
    if (r.mentioned) {
      s.m++;
      if (r.rank != null) {
        s.rSum += r.rank;
        s.rCount++;
      }
    }
  }
  const out: RunAgg = new Map();
  for (const [engine, e] of byEngine) {
    const subjects = new Map<string, SubjectAgg>();
    for (const [cid, s] of e.subj) {
      const denom = s.organicPrompts.size;
      subjects.set(cid, {
        mentions: s.m,
        sov: denom > 0 ? s.m / denom : 0,
        avgRank: s.rCount > 0 ? s.rSum / s.rCount : null,
      });
    }
    out.set(engine, { totalPrompts: e.prompts.size, subjects });
  }
  return out;
}
