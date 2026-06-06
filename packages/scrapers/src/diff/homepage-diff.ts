import type { HomepageStructure, HomepageSection, Cta } from "../parsers/homepage-structure";
import { diffLogos } from "../parsers/social-proof";

/**
 * Structural diff of two HomepageStructure snapshots (patch-16). Emits typed,
 * located changes ("the H1 changed", "a pricing section was added") instead of a
 * flat line diff — so a rotating testimonial carousel or a re-ordered page stops
 * faking changes while a real positioning move stands out, and the downstream AI
 * gets *where* + *what* instead of a noisy blob.
 *
 * PURE and deterministic: same pair of structures → same StructuredChange[].
 * Homepage-only; other sources keep the lexical visible-content diff.
 */

export type ChangeKind =
  | "hero_headline_changed"
  | "hero_subheadline_changed"
  | "hero_cta_changed"
  | "section_added"
  | "section_removed"
  | "section_renamed"
  | "section_body_changed"
  | "section_reordered"
  | "navigation_changed"
  | "meta_changed"
  | "social_proof_changed"
  // patch-17 enrichments — emitted by the worker (pHash / claims / stable
  // testimonial history) or by the social-proof diff below (logos).
  | "visual_redesign"
  | "numeric_claim_changed"
  | "customer_logo_added"
  | "customer_logo_removed"
  | "testimonial_added"
  | "testimonial_removed";

export interface StructuredChange {
  kind: ChangeKind;
  /** Where the change is, e.g. "hero.headline", "sections[pricing]". */
  field: string;
  before: string | null;
  after: string | null;
  /** Local line-to-line delta for section_body_changed. */
  bodyDiff?: { added: string[]; removed: string[] };
  /** Free-form extras for patch-17 kinds (hamming distance, claim variation, …). */
  metadata?: Record<string, unknown>;
}

// A paired section's body must move by more than this fraction of its prior
// content to count as a real change — absorbs minor copy churn.
const BODY_CHANGE_RATIO = 0.1;
// Heading token overlap above which two sections are considered "the same
// section, possibly renamed" rather than one removed + one added.
const RENAME_SIMILARITY = 0.5;
const MAX_BODY_DIFF_LINES = 20;

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

function ctaString(c: Cta | null): string | null {
  if (!c) return null;
  return c.href ? `${c.text} (${c.href})` : c.text;
}

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Sentence-ish segments of a section body, for the local body diff.
function segments(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\s*[•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function diffMeta(prev: HomepageStructure, curr: HomepageStructure): StructuredChange[] {
  const out: StructuredChange[] = [];
  const pairs: Array<[string, string | null, string | null]> = [
    ["meta.title", prev.title || null, curr.title || null],
    ["meta.description", prev.metaDescription, curr.metaDescription],
    ["og.title", prev.openGraph.title, curr.openGraph.title],
    ["og.description", prev.openGraph.description, curr.openGraph.description],
    // patch-32 — an og:image swap is a brand / visual-identity change (rebrand,
    // new hero art); og:type shifts when a site repositions (website↔product).
    ["og.image", prev.openGraph.image, curr.openGraph.image],
    ["og.type", prev.openGraph.type, curr.openGraph.type],
  ];
  for (const [field, before, after] of pairs) {
    if (norm(before) !== norm(after)) {
      out.push({ kind: "meta_changed", field, before, after });
    }
  }
  return out;
}

function diffHero(prev: HomepageStructure, curr: HomepageStructure): StructuredChange[] {
  const out: StructuredChange[] = [];
  if (norm(prev.hero.headline) !== norm(curr.hero.headline)) {
    out.push({
      kind: "hero_headline_changed",
      field: "hero.headline",
      before: prev.hero.headline,
      after: curr.hero.headline,
    });
  }
  if (norm(prev.hero.subheadline) !== norm(curr.hero.subheadline)) {
    out.push({
      kind: "hero_subheadline_changed",
      field: "hero.subheadline",
      before: prev.hero.subheadline,
      after: curr.hero.subheadline,
    });
  }
  const ctaPairs: Array<["primaryCta" | "secondaryCta", Cta | null, Cta | null]> = [
    ["primaryCta", prev.hero.primaryCta, curr.hero.primaryCta],
    ["secondaryCta", prev.hero.secondaryCta, curr.hero.secondaryCta],
  ];
  for (const [name, before, after] of ctaPairs) {
    const b = ctaString(before);
    const a = ctaString(after);
    if (b !== a) {
      out.push({ kind: "hero_cta_changed", field: `hero.${name}`, before: b, after: a });
    }
  }
  return out;
}

interface Pair {
  prevIndex: number;
  currIndex: number;
}

function diffSections(
  prev: HomepageSection[],
  curr: HomepageSection[],
): StructuredChange[] {
  const out: StructuredChange[] = [];
  const currUsed = new Array<boolean>(curr.length).fill(false);
  const pairs: Pair[] = [];
  const removed: number[] = [];

  // Pair prev → curr: exact (normalised) heading first, then same type + similar
  // heading (a rename). Greedy and order-independent on the prev side.
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]!;
    const ph = norm(p.heading).toLowerCase();
    let match = -1;
    for (let j = 0; j < curr.length; j++) {
      if (currUsed[j]) continue;
      if (norm(curr[j]!.heading).toLowerCase() === ph) {
        match = j;
        break;
      }
    }
    if (match === -1) {
      // Pair on heading + body so a rename that shares no title words
      // ("Features" → "Capabilities") is still recognised when the body is
      // unchanged, instead of degrading to a remove + add.
      const pt = tokenSet(`${p.heading} ${p.bodyText}`);
      let best = -1;
      let bestSim = RENAME_SIMILARITY;
      for (let j = 0; j < curr.length; j++) {
        if (currUsed[j]) continue;
        if (curr[j]!.type !== p.type) continue;
        const sim = jaccard(pt, tokenSet(`${curr[j]!.heading} ${curr[j]!.bodyText}`));
        if (sim >= bestSim) {
          bestSim = sim;
          best = j;
        }
      }
      match = best;
    }
    if (match === -1) {
      removed.push(i);
    } else {
      currUsed[match] = true;
      pairs.push({ prevIndex: i, currIndex: match });
    }
  }

  // Removed (in prev, unmatched) and added (in curr, unmatched).
  for (const i of removed) {
    const p = prev[i]!;
    out.push({
      kind: "section_removed",
      field: `sections[${p.type}]`,
      before: p.heading,
      after: null,
    });
  }
  for (let j = 0; j < curr.length; j++) {
    if (currUsed[j]) continue;
    const c = curr[j]!;
    out.push({
      kind: "section_added",
      field: `sections[${c.type}]`,
      before: null,
      after: c.heading,
    });
  }

  // Paired: rename and/or body change.
  for (const { prevIndex, currIndex } of pairs) {
    const p = prev[prevIndex]!;
    const c = curr[currIndex]!;
    if (norm(p.heading).toLowerCase() !== norm(c.heading).toLowerCase()) {
      out.push({
        kind: "section_renamed",
        field: `sections[${c.type}]`,
        before: p.heading,
        after: c.heading,
      });
    }
    // Testimonials and logo walls rotate their content by design — they're
    // tracked by count via socialProof, so never diff their body (that's the
    // carousel false-positive this patch kills).
    if (c.type === "testimonials" || c.type === "logos") continue;
    const prevSegs = segments(p.bodyText);
    const currSegs = segments(c.bodyText);
    const prevSet = new Set(prevSegs);
    const currSet = new Set(currSegs);
    const added = currSegs.filter((s) => !prevSet.has(s));
    const removedSegs = prevSegs.filter((s) => !currSet.has(s));
    const ratio = (added.length + removedSegs.length) / (prevSegs.length || 1);
    if (ratio > BODY_CHANGE_RATIO && (added.length || removedSegs.length)) {
      out.push({
        kind: "section_body_changed",
        field: `sections[${c.type}]`,
        before: p.heading,
        after: c.heading,
        bodyDiff: {
          added: added.slice(0, MAX_BODY_DIFF_LINES),
          removed: removedSegs.slice(0, MAX_BODY_DIFF_LINES),
        },
      });
    }
  }

  // Reordering: among the matched sections, did their relative order change? If
  // the curr indices, taken in prev order, aren't strictly increasing, the page
  // was reshuffled. Emitted once (a pure reorder yields only this change).
  const byPrev = [...pairs].sort((a, b) => a.prevIndex - b.prevIndex);
  let reordered = false;
  for (let i = 1; i < byPrev.length; i++) {
    if (byPrev[i]!.currIndex < byPrev[i - 1]!.currIndex) {
      reordered = true;
      break;
    }
  }
  if (reordered) {
    out.push({
      kind: "section_reordered",
      field: "sections.order",
      before: byPrev.map((p) => prev[p.prevIndex]!.heading).join(" › "),
      after: [...pairs]
        .sort((a, b) => a.currIndex - b.currIndex)
        .map((p) => curr[p.currIndex]!.heading)
        .join(" › "),
    });
  }

  return out;
}

function diffNavigation(prev: HomepageStructure, curr: HomepageStructure): StructuredChange[] {
  const navBefore = prev.navigation.items.map((i) => i.text).sort();
  const navAfter = curr.navigation.items.map((i) => i.text).sort();
  if (JSON.stringify(navBefore) === JSON.stringify(navAfter)) return [];
  return [
    {
      kind: "navigation_changed",
      field: "navigation",
      before: navBefore.join(", ") || null,
      after: navAfter.join(", ") || null,
    },
  ];
}

function diffSocialProof(prev: HomepageStructure, curr: HomepageStructure): StructuredChange[] {
  const out: StructuredChange[] = [];

  // Named customer logos (patch-17): add/remove by normalized brand name.
  const logos = diffLogos(prev.socialProof.customerLogos, curr.socialProof.customerLogos);
  if (logos.added.length > 0) {
    out.push({
      kind: "customer_logo_added",
      field: "socialProof.customerLogos",
      before: null,
      after: logos.added.join(", "),
    });
  }
  if (logos.removed.length > 0) {
    out.push({
      kind: "customer_logo_removed",
      field: "socialProof.customerLogos",
      before: logos.removed.join(", "),
      after: null,
    });
  }
  // Count fallback ONLY when we couldn't name the move (asset-only logos with no
  // alt text) — avoids double-reporting a named add/remove as a count change too.
  if (
    logos.added.length === 0 &&
    logos.removed.length === 0 &&
    prev.socialProof.customerLogos.length !== curr.socialProof.customerLogos.length
  ) {
    out.push({
      kind: "social_proof_changed",
      field: "socialProof.customerLogos.count",
      before: String(prev.socialProof.customerLogos.length),
      after: String(curr.socialProof.customerLogos.length),
    });
  }
  // Testimonial COUNT only (carousel-safe): a rotating carousel keeps the full
  // set in the DOM so the count is stable. Detailed add/remove (which quote came
  // / went) is worker-orchestrated on snapshot history with a stability window.
  if (prev.socialProof.testimonialCount !== curr.socialProof.testimonialCount) {
    out.push({
      kind: "social_proof_changed",
      field: "socialProof.testimonialCount",
      before: String(prev.socialProof.testimonialCount),
      after: String(curr.socialProof.testimonialCount),
    });
  }
  return out;
}

export function diffHomepages(
  prev: HomepageStructure,
  curr: HomepageStructure,
): StructuredChange[] {
  return [
    ...diffHero(prev, curr),
    ...diffSections(prev.sections, curr.sections),
    ...diffNavigation(prev, curr),
    ...diffMeta(prev, curr),
    ...diffSocialProof(prev, curr),
  ];
}

/**
 * Renders a StructuredChange[] as readable text for the `changes.diff_text`
 * column (so downstream consumers that read diffText — the AI insight prompt, the
 * change cards — keep working) and as a stable, deterministic input for the
 * classifier's cache key.
 */
export function renderStructuredChanges(changes: StructuredChange[]): string {
  return changes
    .map((c) => {
      const head = `[${c.kind}] ${c.field}`;
      if (c.bodyDiff && (c.bodyDiff.added.length || c.bodyDiff.removed.length)) {
        const removed = c.bodyDiff.removed.map((l) => `  - ${l}`).join("\n");
        const added = c.bodyDiff.added.map((l) => `  + ${l}`).join("\n");
        return [head, removed, added].filter(Boolean).join("\n");
      }
      return `${head}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`;
    })
    .join("\n");
}
