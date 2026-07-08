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

// Normalize + drop a trailing TLD so a roster name like "capydex.fr" matches "Capydex".
function subjectCore(name: string): string {
  return normalize(name).replace(TRAILING_TLD, "").trim();
}

/**
 * True when `text` literally names `name`: accent- and case-insensitive, whole-token
 * (word boundaries on both sides), TLD-tolerant, and whitespace-flexible for multi-word
 * brands ("Acme CRM"). Used to validate an LLM `mentioned` verdict against the answer.
 */
export function textNamesSubject(text: string, name: string): boolean {
  const core = subjectCore(name);
  if (core.length < 2) return false; // 1-char names are too noisy to word-match
  const hay = normalize(text);
  const pattern = core
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
    .replace(/ /g, "\\s+"); // any run of whitespace between name tokens
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u");
  return re.test(hay);
}
