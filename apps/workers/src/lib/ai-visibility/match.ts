// Deterministic name-presence check for AI Visibility mention detection.
//
// The answer-engine reply is classified by an LLM ("which of these subjects does this
// answer mention?"). A weak classifier tends to CONFIRM any name it's handed in the
// subject list, inventing phantom mentions — especially the self product, which shares
// the question's domain. This guard keeps a `mentioned=true` verdict only when the
// subject's name literally appears in the text, killing those false positives. It's
// intentionally strict: for share-of-voice, missing a mention under an unusual alias is
// far less harmful than counting one that never happened.

// Trailing public suffix so a roster name like "capydex.fr" still matches "Capydex" in
// prose. Only stripped at the very end of the name, never mid-token.
const TRAILING_TLD = /\.(com|io|app|dev|ai|co|net|org|fr|de|es|it|eu|uk|us|gg|xyz)$/i;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Accent- and case-fold `s` while keeping an index back to the SOURCE string, so a match
// found on the folded text can be cut out of the original. Folding the whole string in one
// `.normalize("NFD")` would be shorter but shifts every index after the first accent, which
// is exactly what the excerpt builder cannot afford.
function fold(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const folded = s[i]!.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    for (const ch of folded) {
      text += ch;
      map.push(i);
    }
  }
  return { text, map };
}

// Normalize + drop a trailing TLD so a roster name like "capydex.fr" matches "Capydex".
function subjectCore(name: string): string {
  return normalize(name).replace(TRAILING_TLD, "").trim();
}

/** Whole-token, whitespace-flexible matcher for one roster name; null for unusable names. */
function subjectRegex(name: string, flags = "u"): RegExp | null {
  const core = subjectCore(name);
  if (core.length < 2) return null; // 1-char names are too noisy to word-match
  const pattern = core
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
    .replace(/ /g, "\\s+"); // any run of whitespace between name tokens
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * Where `text` first names `name`, as a [start, end) range in the ORIGINAL string, or null.
 * Accent- and case-insensitive, whole-token, TLD-tolerant, whitespace-flexible for
 * multi-word brands ("Acme CRM").
 */
export function findSubject(text: string, name: string): { start: number; end: number } | null {
  const re = subjectRegex(name);
  if (!re) return null;
  const { text: hay, map } = fold(text);
  const m = re.exec(hay);
  if (!m) return null;
  const start = map[m.index];
  const end = map[m.index + m[0].length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end: end + 1 };
}

/**
 * True when `text` literally names `name`. Used to validate an LLM `mentioned` verdict
 * against the answer.
 */
export function textNamesSubject(text: string, name: string): boolean {
  return findSubject(text, name) !== null;
}

// --- Evidence excerpt ----------------------------------------------------------------
//
// The quote shown under a question used to be `answer.slice(0, 2000)` — a blind head cut.
// Answer engines open with a long stretch of generic framing and only name vendors further
// down, so on the 2026-08-01 prod runs 10 of the 26 credited mentions sat PAST that cut:
// the page listed three competitors as named above a quote in which none of them appear,
// which reads as an invented count. The counts were right (they are validated against the
// FULL answer above); the evidence was the part that lied. So keep the opening — it is the
// answer's actual thesis — and add a window around each named brand's first occurrence.

const HEAD_CHARS = 700; // the answer's own framing, always kept
const LEAD_CHARS = 160; // context before a named brand
const TRAIL_CHARS = 240; // context after it
const ELLIPSIS = " […] ";

/** Push a cut to the nearest whitespace within `slack` chars, so windows don't split words. */
function snap(text: string, at: number, dir: -1 | 1, slack = 40): number {
  for (let i = 0; i <= slack; i++) {
    const j = at + dir * i;
    if (j <= 0) return 0;
    if (j >= text.length) return text.length;
    if (/\s/.test(text[j]!)) return dir === -1 ? j + 1 : j;
  }
  return at;
}

/**
 * Evidence quote for one engine answer: its opening plus a window around each named
 * subject, elided with " […] " and capped at `budget` characters (kept at the historic
 * 2000 so the stored payload doesn't grow — this table holds one copy per roster subject).
 * Windows are emitted in the order they appear in the answer; a brand whose window doesn't
 * fit the budget is dropped rather than half-shown.
 */
export function buildEvidenceExcerpt(answer: string, names: string[], budget = 2000): string {
  if (answer.length <= budget) return answer;

  const windows: Array<{ start: number; end: number }> = [
    { start: 0, end: snap(answer, Math.min(HEAD_CHARS, answer.length), 1) },
  ];
  for (const name of names) {
    const hit = findSubject(answer, name);
    if (!hit) continue;
    windows.push({
      start: snap(answer, Math.max(0, hit.start - LEAD_CHARS), -1),
      end: snap(answer, Math.min(answer.length, hit.end + TRAIL_CHARS), 1),
    });
  }

  // Merge overlapping / touching windows so the same sentence is never quoted twice.
  windows.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }

  let out = "";
  let reached = 0;
  for (const w of merged) {
    const piece = answer.slice(w.start, w.end);
    const joiner = out === "" ? (w.start > 0 ? ELLIPSIS.trimStart() : "") : ELLIPSIS;
    if (out.length + joiner.length + piece.length > budget) continue;
    out += joiner + piece;
    reached = w.end;
  }
  // Every window overflowed the budget (a single very long one): fall back to the head cut.
  if (out === "") {
    out = answer.slice(0, budget);
    reached = budget;
  }
  if (reached < answer.length) out += ELLIPSIS.trimEnd();
  return out;
}
