// Search providers hand back a page as markdown, headings and bullets included
// ("# Kilo (Kilo Code Inc.)", "## About", "- Industry: Software"). Rendered as plain
// text in a queue row those markers are pure noise, so they are stripped before the
// text is stored or shown. Pure and dependency-free: a full markdown parser would
// cost a dependency in three packages to throw away everything it parses.

const HORIZONTAL_RULE = /^([-*_])\s*(?:\1\s*){2,}$/;
// "| --- | :-- |" — the alignment row of a table, which carries no text.
const TABLE_SEPARATOR = /^\|?[\s:|-]+\|[\s:|-]*$/;
const CODE_FENCE = /^(?:```|~~~)/;
// The text is optional so a bare "###" is recognised as an empty heading and dropped,
// rather than falling through to be read as a sentence.
const ATX_HEADING = /^(#{1,6})(?:\s+(.*?))?\s*#*$/;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE = /^>\s?/;
// "- [x] shipped" — the checkbox left over once the list marker is gone.
const TASK_BOX = /^\[[ xX]\]\s+/;
// A line of "===" or "---" under a paragraph makes the line above a heading; it
// never carries text of its own.
const SETEXT_UNDERLINE = /^(?:=+|-+)$/;

const TERMINAL_PUNCTUATION = /[.!?:;,…]$/;

/** Markers that only wrap text, removed in place so the text they wrap survives. */
function stripInline(line: string): string {
  return (
    line
      // Images carry no reading value once the URL is gone.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Autolinks: <https://example.com> keeps the URL, it is the text.
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      // Underscores only pair as emphasis around whole words — snake_case and URLs
      // are full of them and must survive.
      .replace(/\b_([^_\n]+)_\b/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      // Backslash escapes ("\#", "\*") once the markup they protected is gone.
      .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
  );
}

type Block = { text: string; standalone: boolean };

/**
 * Flattens markdown into one plain-text paragraph.
 *
 * Headings and list items become their own sentence (a "." is added when they end
 * without punctuation), so "## About" followed by a description reads as
 * "About. Kilo Code is …" rather than running the two together. Wrapped paragraph
 * lines are rejoined with a space instead, which is why the block structure is
 * tracked at all — appending a "." per physical line would chop every hard-wrapped
 * sentence in three.
 *
 * Returns "" for input that was nothing but markup.
 */
export function stripMarkdown(input: string): string {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ text: paragraph.join(" "), standalone: true });
    paragraph = [];
  };

  let inFence = false;

  for (const rawLine of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      flushParagraph();
      continue;
    }
    if (inFence) continue;

    if (line === "") {
      flushParagraph();
      continue;
    }
    if (HORIZONTAL_RULE.test(line) || SETEXT_UNDERLINE.test(line) || TABLE_SEPARATOR.test(line)) {
      flushParagraph();
      continue;
    }

    const unquoted = line.replace(BLOCKQUOTE, "");
    const heading = ATX_HEADING.exec(unquoted);
    const listed = !heading && LIST_MARKER.test(unquoted);
    const body = heading
      ? (heading[2] ?? "")
      : listed
        ? unquoted.replace(LIST_MARKER, "").replace(TASK_BOX, "")
        : unquoted;

    // A table row is a sequence of cells, not a sentence: the pipes become spaces.
    const text = collapse(stripInline(body).replace(/\s*\|\s*/g, " "));
    if (text === "") continue;

    if (heading || listed) {
      flushParagraph();
      blocks.push({ text, standalone: true });
    } else {
      paragraph.push(text);
    }
  }
  flushParagraph();

  return collapse(
    blocks
      .map((b) => (b.standalone && !TERMINAL_PUNCTUATION.test(b.text) ? `${b.text}.` : b.text))
      .join(" "),
  );
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
