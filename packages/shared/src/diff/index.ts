import { createHash } from "node:crypto";
import { diffLines, type Change as DiffChange } from "diff";

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Strips per-request volatile tokens from HTML before change detection. CSRF
 * tokens, CSP nonces, and anti-forgery inputs are regenerated on every page
 * load; left in place they flip the content hash and produce a spurious change
 * row + reschedule + classification on every single scrape.
 *
 * Apply symmetrically to BOTH sides of the diff and to the hash input. Never
 * apply it to what we persist to R2 — extractors still need the raw HTML.
 */
export function normalizeHtmlForDiff(html: string): string {
  return html
    // CSRF / XSRF / verification token meta tags (any attribute order).
    .replace(
      /<meta\b[^>]*\bname=["'](?:csrf-token|csrf_token|csrf-param|_csrf|xsrf-token|x-csrf-token|authenticity_token|request-id|x-request-id|trace-id)["'][^>]*>/gi,
      "",
    )
    // Hidden CSRF / anti-forgery inputs.
    .replace(
      /<input\b[^>]*\bname=["'](?:_csrf|csrf_token|csrf-token|authenticity_token|__RequestVerificationToken|xsrf|_token)["'][^>]*>/gi,
      "",
    )
    // CSP nonces on script/style/link tags.
    .replace(/\snonce=["'][^"']*["']/gi, "")
    // Common token assignments inside inline scripts / JSON state.
    .replace(
      /["']?(?:csrf[-_]?token|csrfToken|xsrfToken|authenticity_token)["']?\s*[:=]\s*["'][^"']*["']/gi,
      "",
    )
    .trim();
}

export interface TextDiffResult {
  hasChanges: boolean;
  added: string[];
  removed: string[];
  diffText: string;
}

/**
 * Prefix EVERY physical line of a hunk, not just its first.
 *
 * `diffLines` groups consecutive changed lines into ONE part, so `part.value` is
 * routinely multi-line. Marking only the first line left every continuation line
 * bare, and a bare line has no polarity: readers downstream either guessed
 * (the AI prompts, which is how a REMOVED headline got reported as a competitor's
 * new announcement) or dropped it (the web diff preview, which skips any line
 * without a marker). One marker per line makes the side of a line a property of
 * the text instead of a convention only the first line carries.
 */
function prefixLines(block: string, marker: "-" | "+"): string {
  return block
    .split("\n")
    .map((line) => `${marker} ${line}`)
    .join("\n");
}

export function computeTextDiff(before: string, after: string): TextDiffResult {
  const changes: DiffChange[] = diffLines(before, after);
  const added: string[] = [];
  const removed: string[] = [];

  for (const part of changes) {
    if (part.added) added.push(part.value.trim());
    if (part.removed) removed.push(part.value.trim());
  }

  const diffText = [
    ...removed.map((l) => prefixLines(l, "-")),
    ...added.map((l) => prefixLines(l, "+")),
  ].join("\n");

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    added,
    removed,
    diffText,
  };
}

/**
 * Split a persisted `changes.diff_text` back into its two sides.
 *
 * Tolerant of BOTH formats on purpose: rows written before per-line prefixing
 * carry continuation lines with no marker, and those belong to the side the last
 * marker opened. Reading them as their own side (or dropping them) would
 * misattribute exactly the text that caused the inversions this split exists to
 * prevent. A leading unmarked line has no side yet and is discarded.
 */
export function splitDiffText(diffText: string): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of classifyDiffLines(diffText)) {
    (line.side === "removed" ? removed : added).push(line.text);
  }
  return { removed, added };
}

interface ClassifiedDiffLine {
  side: "removed" | "added";
  /** The line as written, marker included — what a re-serialisation must emit. */
  raw: string;
  /** The line's content, marker and surrounding whitespace stripped. */
  text: string;
}

/**
 * The ONE place the `-`/`+` convention (and its tolerance for unmarked
 * continuation lines) is decoded. Both readers of a persisted diff go through it,
 * so a change to the convention cannot land on one and not the other.
 */
function classifyDiffLines(diffText: string): ClassifiedDiffLine[] {
  const out: ClassifiedDiffLine[] = [];
  let side: "removed" | "added" | null = null;

  for (const raw of diffText.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("- ") || line === "-") {
      side = "removed";
      out.push({ side, raw: line, text: line.slice(1).trim() });
    } else if (line.startsWith("+ ") || line === "+") {
      side = "added";
      out.push({ side, raw: line, text: line.slice(1).trim() });
    } else if (side) {
      // A leading unmarked line has no side yet and is discarded.
      out.push({ side, raw: line, text: line.trim() });
    }
  }

  return out;
}

/** What a `changes.diff_text` column stores. */
export const DIFF_TEXT_MAX_CHARS = 50_000;

const TRUNCATION_MARKER = "… [truncated to fit both sides of the diff]";

function cutSide(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const kept = Math.max(0, budget - TRUNCATION_MARKER.length - 1);
  return `${text.slice(0, kept)}\n${TRUNCATION_MARKER}`;
}

/**
 * Cap a diff for storage while keeping BOTH of its sides.
 *
 * `computeTextDiff` writes every removed line, then every added line, so a flat
 * `slice(0, max)` spends the whole budget on removals and can drop the added side
 * entirely. That is not a smaller diff, it is a different one: what the page NOW
 * shows disappears, and every reader downstream — the classifier, the insight, the
 * faithfulness check, the web preview — sees a page that was deleted. It happened
 * on an App Store reviews snapshot, one 63 KB JSON line per side: the stored diff
 * was the truncated removed side and nothing else, and the signal reported a
 * competitor removing all its reviews.
 *
 * Each side gets half the budget, and a side that needs less than half hands the
 * remainder to the other, so the common lopsided case (a one-line removal against
 * a large addition) still stores the large side nearly whole. A cut side says so:
 * a silent cap reads downstream as the whole story.
 */
export function truncateDiffText(diffText: string, maxChars = DIFF_TEXT_MAX_CHARS): string {
  if (diffText.length <= maxChars) return diffText;

  const removed: string[] = [];
  const added: string[] = [];
  for (const line of classifyDiffLines(diffText)) {
    (line.side === "removed" ? removed : added).push(line.raw);
  }
  const removedText = removed.join("\n");
  const addedText = added.join("\n");

  // Nothing parseable, or a genuinely one-sided diff: there is no second side to
  // protect, so cut as before (with the marker, since the cap still applies).
  if (removedText.length === 0 || addedText.length === 0) {
    return cutSide(diffText, maxChars);
  }

  // -1 for the newline that rejoins the two sides.
  const budget = maxChars - 1;
  const half = Math.floor(budget / 2);
  const removedBudget =
    removedText.length <= half ? removedText.length : Math.max(half, budget - addedText.length);

  return `${cutSide(removedText, removedBudget)}\n${cutSide(addedText, budget - removedBudget)}`;
}

/**
 * The ONE representation of a lexical diff handed to a model.
 *
 * A bare `-`/`+` blob asks the model to know a convention that nothing in the
 * prompt states, and the two sides are not symmetric in consequence: describing
 * ADDED text as the competitor's new position is right, describing REMOVED text
 * the same way inverts the story. Labelled blocks make the side explicit, and the
 * legend states what each one MEANS so the rule is in the prompt rather than in
 * the reader's assumptions.
 *
 * Used for the prompt AND as the `sourceText` every grounding/faithfulness check
 * verifies against, so a quote can be traced back to the side it came from
 * instead of matching anywhere in an unlabelled blob.
 */
export function formatDiffForPrompt(diffText: string): string {
  const { removed, added } = splitDiffText(diffText);
  // Nothing parseable (an empty or marker-less blob) — hand it back untouched
  // rather than wrapping it in labels that would claim a side it doesn't have.
  if (removed.length === 0 && added.length === 0) return diffText;

  const blocks: string[] = [];
  if (removed.length > 0) {
    blocks.push(`<removed>\n${removed.join("\n")}\n</removed>`);
  }
  if (added.length > 0) {
    blocks.push(`<added>\n${added.join("\n")}\n</added>`);
  }

  return `${DIFF_POLARITY_LEGEND}\n${blocks.join("\n")}`;
}

/**
 * Stated once, next to the blocks it describes. Exported so the prompts that
 * reason about polarity and the tests that assert it read the same sentence.
 *
 * Deliberately names the blocks in prose instead of quoting the tags: this line is
 * PREPENDED to the text `parseLabelledDiff` reads back, so a literal `<removed>`
 * here would open a block the parser then closes at the real block's tag, and every
 * side would come back wrong.
 */
export const DIFF_POLARITY_LEGEND = `The removed block below is text the page NO LONGER shows. The added block is text the page NOW shows.`;

// Anchored to whole lines: a scraped page can itself contain the literal string
// "<added>", and only the block WE emit sits alone on its own line.
const REMOVED_BLOCK = /^<removed>\n([\s\S]*?)\n<\/removed>$/m;
const ADDED_BLOCK = /^<added>\n([\s\S]*?)\n<\/added>$/m;

/**
 * Read back the two sides of a `formatDiffForPrompt` output, so a verifier can ask
 * WHICH side a quote came from instead of only whether it occurs somewhere.
 *
 * Returns null for anything that is not a labelled diff — a battle card's evidence,
 * a digest's signal list — so callers keep their exact prior behaviour on every
 * source that has no sides to confuse.
 */
export function parseLabelledDiff(text: string): { removed: string; added: string } | null {
  const removed = text.match(REMOVED_BLOCK)?.[1];
  const added = text.match(ADDED_BLOCK)?.[1];
  if (removed === undefined && added === undefined) return null;
  return { removed: removed ?? "", added: added ?? "" };
}
