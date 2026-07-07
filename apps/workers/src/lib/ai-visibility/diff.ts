// AI Visibility diff — phase 3 (docs/ai-visibility.md). Pure functions (no DB): turn
// the raw per-(prompt × subject) rows of a run into per-engine share-of-voice, then
// compare two runs and surface only the meaningful shifts worth a signal. Idempotent
// by construction: two identical runs produce identical aggregates → zero deltas.

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

export type DeltaType = "self_dropped" | "overtaken" | "competitor_appeared";

export interface VisibilityDelta {
  type: DeltaType;
  engine: string;
  competitorId: string; // the subject the signal is about (self for self_dropped)
  subjectBefore: number;
  subjectAfter: number;
  selfBefore: number;
  selfAfter: number;
  severity: "medium" | "high";
}

const sovOf = (agg: EngineAgg | undefined, id: string | null): number =>
  (id && agg?.subjects.get(id)?.sov) || 0;

// Compare the previous run to the current one and emit only meaningful shifts. An
// engine with no previous baseline yields nothing (the first run just establishes the
// baseline, like tech-stack's first scrape). Self-drop and overtake need a self product;
// competitor-appeared works regardless.
export function computeDeltas(
  prev: RunAgg,
  curr: RunAgg,
  selfId: string | null,
): VisibilityDelta[] {
  const deltas: VisibilityDelta[] = [];
  for (const [engine, currEng] of curr) {
    const prevEng = prev.get(engine);
    if (!prevEng) continue; // no baseline → no signal

    const selfAfter = sovOf(currEng, selfId);
    const selfBefore = sovOf(prevEng, selfId);

    if (selfId && selfBefore > 0 && selfAfter === 0) {
      deltas.push({
        type: "self_dropped",
        engine,
        competitorId: selfId,
        subjectBefore: selfBefore,
        subjectAfter: selfAfter,
        selfBefore,
        selfAfter,
        severity: "high",
      });
    }

    for (const [cid, cAgg] of currEng.subjects) {
      if (cid === selfId) continue;
      const after = cAgg.sov;
      const before = sovOf(prevEng, cid);
      const overtook = selfId !== null && before <= selfBefore && after > selfAfter;
      const appeared = before === 0 && after > 0;
      if (overtook) {
        deltas.push({
          type: "overtaken",
          engine,
          competitorId: cid,
          subjectBefore: before,
          subjectAfter: after,
          selfBefore,
          selfAfter,
          severity: "high",
        });
      } else if (appeared) {
        deltas.push({
          type: "competitor_appeared",
          engine,
          competitorId: cid,
          subjectBefore: before,
          subjectAfter: after,
          selfBefore,
          selfAfter,
          severity: "medium",
        });
      }
    }
  }
  return deltas;
}
