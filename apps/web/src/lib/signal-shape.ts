import type { Signal } from "./api";
import type { DigestUrgency } from "./digest-shape";

/**
 * The signals list, shaped the way the brief is: a short line per signal, under
 * the same three tiers.
 *
 * A signal's `insight` is a paragraph the model wrote to be read once, in the
 * detail pane ("The competitor's page now lists 6 open positions and adds an
 * Operations role with 1 open position, after removing the previous statement of
 * 5 open positions."). Fifty unread rows of that is fifty paragraphs. The list
 * needs a title; the paragraph is one row-press away.
 *
 * The shortening is deterministic and pure so it can be pinned by tests — a
 * title that drops the wrong half states a change that never happened.
 */

/** Longest title we render before cutting. Roughly the 400px column at 13px. */
export const TITLE_MAX = 72;
/** Below this a cut has eaten the sentence, so we keep the longer form. */
const TITLE_MIN = 16;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "The competitor's careers page now lists…" → "now lists…". Both halves are
// already on the row: the competitor as the avatar (and, grouped, the heading
// above it), the surface as the source label on the meta line.
const SUBJECT = /^(?:the\s+)?competitor(?:'s|’s|s')?\s+/i;
const SURFACE =
  /^(?:(?:careers?|jobs?|pricing|product|blog|changelog|homepage|landing|docs?|documentation|security|about|status|help|support)\s+)?(?:page|site|website|listing|board|section)\s+/i;

// Trailing qualifiers: past these the sentence restates what it just said, in
// the past tense. "up from" / "down from" are deliberately NOT here — they carry
// the previous value, which is the half of a change a title most needs.
const CLAUSE =
  /,\s+(?:after|which|while|whilst|whereas|though|although|following|replacing|compared)\b/i;

// The DEFINITE generic subject, anywhere but the front of the sentence (the front
// is SUBJECT's job — the row already carries the name there). A bare "competitor"
// is left alone: it is a common noun in "a new competitor entered the space", and
// swapping a name into that sentence states something the model never said.
const GENERIC_SUBJECT = /\bthe\s+competitor(?:'s|’s)?\b/gi;

/**
 * Put the competitor's NAME where the model wrote "the competitor".
 *
 * The insight prompt hands the model the name and it still writes the generic
 * subject, which is what made a screen of fifty signals read as fifty rows about
 * one unnamed company (OUT-179). Doing it here rather than only in the prompt
 * fixes the backlog too: every signal already stored keeps its generic prose
 * forever otherwise.
 */
export function nameCompetitor(
  text: string,
  competitorName: string | null | undefined,
): string {
  const name = competitorName?.trim();
  if (!name) return text;
  return text.replace(GENERIC_SUBJECT, (match) =>
    /['’]s$/.test(match) ? `${name}'s` : name,
  );
}

/** The sentence break, ignoring the periods inside "$16.00" and "v2.1". */
function firstSentence(text: string): string {
  const m = /[.!?](?:\s|$)/.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/**
 * Cut an over-long title at the last break the sentence already offers, rather
 * than mid-phrase. Falls back to a word-boundary ellipsis when it offers none.
 */
function shorten(text: string): string {
  if (text.length <= TITLE_MAX) return text;
  const head = text.slice(0, TITLE_MAX);
  const at = Math.max(
    head.lastIndexOf(" and "),
    head.lastIndexOf(", "),
    head.lastIndexOf(" with "),
  );
  if (at >= TITLE_MIN) return text.slice(0, at);
  const space = head.lastIndexOf(" ");
  return `${text.slice(0, space > TITLE_MIN ? space : TITLE_MAX).trimEnd()}…`;
}

/**
 * The one-line form of a signal's insight, for a list row. Never invents a word:
 * every title is a prefix of the insight with its leading subject removed.
 */
export function signalTitle(
  signal: Pick<Signal, "insight" | "competitorName">,
): string {
  let text = signal.insight.replace(/\s+/g, " ").trim();
  if (!text) return "Signal";

  const name = signal.competitorName?.trim();
  if (name) {
    text = text.replace(new RegExp(`^${escapeRe(name)}(?:'s|’s)?\\s+`, "i"), "");
  }
  text = text.replace(SUBJECT, "").replace(SURFACE, "");
  // Whatever generic subject survives the leading strip is mid-sentence, where the
  // row has nothing else to say who it means.
  text = nameCompetitor(text, name);

  text = firstSentence(text);
  const clause = CLAUSE.exec(text);
  if (clause && clause.index >= TITLE_MIN) text = text.slice(0, clause.index);

  text = shorten(text.trim());
  if (!text) return signal.insight.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The brief's three tiers, applied to a signal. The brief sorts a week into what
 * needs an answer, what is worth watching, and what is merely noted; the list is
 * the same week seen one signal at a time, so it sorts by the same rule and
 * borrows the same labels (URGENCY_META) rather than inventing a second
 * vocabulary for the same idea.
 *
 * A user severity override wins, exactly as it does everywhere the band shows.
 */
export function signalTier(
  signal: Pick<Signal, "severity" | "severityOverride">,
): DigestUrgency {
  const sev = signal.severityOverride ?? signal.severity;
  if (sev === "critical" || sev === "high") return "action_required";
  if (sev === "medium") return "watch";
  return "fyi";
}

export { URGENCY_META, URGENCY_ORDER } from "./digest-shape";
export type { DigestUrgency };
