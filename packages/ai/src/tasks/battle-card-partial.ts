import { BattleCardSchema, type BattleCardContent } from "./battle-card";

// Reads a battle card that is still being written. The verification pass streams its
// reply, and this turns whatever has arrived so far into the entries that are already
// complete plus the one sentence still being typed — so the card can be watched being
// written instead of appearing whole once the job is over.
//
// It never guesses: a half-written sentence is returned as `typing`, never as an
// entry, and an object entry missing a field is dropped until its other half lands.
// Anything unparseable yields an empty read, because showing nothing for one more
// tick is always better than showing a claim the model had not finished making.

export type PartialBattleCard = Partial<BattleCardContent>;

export interface PartialCardRead {
  /** The entries the model has finished writing, in the shape the card renders. */
  content: PartialBattleCard;
  /** The sentence currently being written, if any — rendered with the caret. */
  typing: string | null;
  /** Which section that sentence belongs to, so it lands under the right heading. */
  typingKey: keyof BattleCardContent | null;
}

const EMPTY: PartialCardRead = { content: {}, typing: null, typingKey: null };

/**
 * Repairs the truncated JSON of a reply in flight, then keeps only what is complete.
 * The repair is purely structural (close what is open, drop what is half-written) —
 * no field is ever invented.
 */
export function parsePartialCard(raw: string): PartialCardRead {
  const text = stripFence(raw);
  const start = text.indexOf("{");
  if (start === -1) return EMPTY;

  const scan = scanJson(text.slice(start));
  if (!scan) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(scan.closed);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY;

  const typingKey =
    scan.typing && scan.lastKey && scan.lastKey in BattleCardSchema.shape
      ? (scan.lastKey as keyof BattleCardContent)
      : null;
  return {
    content: keepComplete(parsed as Record<string, unknown>),
    typing: scan.typing,
    typingKey,
  };
}

/** Providers sometimes open with a ```json fence even when asked not to. */
function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*)/);
  return fenced?.[1] ?? raw;
}

/**
 * Walks the text once, tracking the open structures and the string state, and
 * returns it closed off: the half-written string is cut (and handed back as
 * `typing`), the dangling comma after it goes, and every open bracket is closed.
 */
function scanJson(
  text: string,
): { closed: string; typing: string | null; lastKey: string | null } | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let end = text.length;
  let typing: string | null = null;
  // The section the model is currently filling: the last key written at the root of
  // the card. Nested keys (an objection's own fields) sit deeper and never take over.
  let lastKey: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (stack.length === 1 && nextMeaningfulChar(text, i + 1) === ":") {
          lastKey = text.slice(stringStart + 1, i);
        }
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringStart = i;
    } else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (inString) {
    // Cut back to the opening quote of the sentence in flight. What was inside it is
    // the text being typed — unescaped, since it is about to be rendered as prose.
    const partial = text.slice(stringStart + 1);
    typing = unescapeJsonString(partial) || null;
    end = stringStart;
  }

  let closed = text.slice(0, end).replace(/[\s,:]+$/, "");
  // A key whose value never arrived ("their_weaknesses" with nothing after it) is
  // not a fact yet either — drop it, with the comma that introduced it.
  const danglingKey = closed.match(/([{,])\s*"(?:[^"\\]|\\.)*"$/);
  if (danglingKey?.index !== undefined) {
    closed = closed.slice(0, danglingKey.index) + (danglingKey[1] === "{" ? "{" : "");
  }
  for (let i = stack.length - 1; i >= 0; i--) closed += stack[i] === "{" ? "}" : "]";
  return { closed, typing, lastKey };
}

/** The next character that is not whitespace, used to tell a key from a value. */
function nextMeaningfulChar(text: string, from: number): string | null {
  for (let i = from; i < text.length; i++) {
    if (!/\s/.test(text[i]!)) return text[i]!;
  }
  return null;
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/\\?$/, "")}"`) as string;
  } catch {
    // A lone escape or control character at the cut point — show the plain text.
    return s.replace(/\\[nrt]/g, " ").replace(/\\/g, "");
  }
}

/** Keeps the known sections, and inside them only the entries that are whole. */
function keepComplete(obj: Record<string, unknown>): PartialBattleCard {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(BattleCardSchema.shape)) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    if (key === "common_objections") {
      const rows = value.filter(
        (v) =>
          !!v &&
          typeof v === "object" &&
          typeof (v as { objection?: unknown }).objection === "string" &&
          typeof (v as { response?: unknown }).response === "string",
      );
      if (rows.length > 0) out[key] = rows;
      continue;
    }
    const rows = value.filter((v) => typeof v === "string" && v.length > 0);
    if (rows.length > 0) out[key] = rows;
  }
  return out as PartialBattleCard;
}
