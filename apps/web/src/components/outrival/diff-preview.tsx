"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { splitDiffText } from "@outrival/shared";
import { eyebrowClass } from "@/components/outrival/eyebrow";
import { denoiseDiffLines, type DiffLine } from "@/lib/diff-denoise";

export type { DiffLine };

/**
 * Render a persisted diff as sided lines.
 *
 * Side assignment is delegated to `splitDiffText` so the preview and the AI
 * pipeline read a diff the same way. The local loop this replaces demanded a
 * marker on every line and skipped anything without one, which silently hid the
 * continuation lines of every multi-line hunk: before per-line prefixing landed,
 * only a hunk's FIRST line ever carried a marker. Rows written then are still in
 * the table, so tolerating them is not a transitional nicety.
 *
 * The ADDED side is emitted first and holds half the budget. Both properties are
 * load-bearing. Emitting removals first, as this did, meant a change with more
 * removed lines than the cap rendered nothing but deleted text: the news never
 * reached the reader, and text with no visible counterpart reads as a competitor's
 * new position, which is the exact inversion the per-line prefixing exists to
 * prevent. Reserving half the budget per side keeps a long removal run from
 * starving the additions even under the cap, and either side may spend the other's
 * unused slack, so a one-sided change still fills the space.
 *
 * `denoise` drops the page chrome (see `denoiseDiffLines`). It runs BEFORE the
 * budget is split, or the cap would be spent on the cookie notice and the news
 * would sit behind the fold.
 */
export function parseDiff(
  diffText: string,
  maxLines = 18,
  denoise = false,
): { lines: DiffLine[]; truncated: boolean } {
  const { removed, added } = splitDiffText(diffText);

  const clean = (block: string[]) =>
    block.map((raw) => stripHtml(raw).trim()).filter((text) => text.length > 0);
  let addedLines = clean(added);
  let removedLines = clean(removed);

  if (denoise) {
    const kept = denoiseDiffLines([
      ...addedLines.map((text) => ({ kind: "add" as const, text })),
      ...removedLines.map((text) => ({ kind: "remove" as const, text })),
    ]);
    addedLines = kept.filter((l) => l.kind === "add").map((l) => l.text);
    removedLines = kept.filter((l) => l.kind === "remove").map((l) => l.text);
  }

  // Half each, then hand the unused half to the other side.
  const half = Math.ceil(maxLines / 2);
  const addedBudget = Math.min(addedLines.length, Math.max(half, maxLines - removedLines.length));
  const removedBudget = Math.max(0, maxLines - addedBudget);

  const lines: DiffLine[] = [
    ...addedLines.slice(0, addedBudget).map((text) => ({ kind: "add" as const, text })),
    ...removedLines.slice(0, removedBudget).map((text) => ({ kind: "remove" as const, text })),
  ];

  return {
    lines,
    truncated: addedLines.length > addedBudget || removedLines.length > removedBudget,
  };
}

/**
 * How many lines a caller's own "Show all N lines" control should promise.
 *
 * The panel used to count the newlines of the raw text, which over-promised by
 * everything the render drops: markup-only lines then, page chrome now. Asking
 * the parser is the only count that can't drift from what appears.
 */
export function countDiffLines(diffText: string, denoise = false): number {
  return parseDiff(diffText, Number.MAX_SAFE_INTEGER, denoise).lines.length;
}

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * The lines a change added and removed, as they read on the page.
 *
 * Shared by the competitor Activity feed (behind "Show raw diff") and by a
 * signal's Evidence section, where for most sources it is the ONLY evidence
 * there is: half the feed carries no before/after pair and no structured
 * breakdown, and the facts a reader wants (which roles, which plans, which
 * endpoints) are in these lines and nowhere else on the signal.
 */
export function DiffPreview({
  diffText,
  maxLines = 18,
  /**
   * Drop the trailing truncation note. For a caller that already offers a
   * "Show all N lines" control, the note restates what the control answers, one
   * line above it.
   */
  hideTruncationNote = false,
  /**
   * Drop the page's navigation, legal and language chrome. Opt-in, because the
   * Activity tab's control says "Show raw diff" and a filtered diff would make
   * that label a lie. The signal surfaces, which are reading FOR the change
   * rather than auditing the capture, pass it.
   */
  denoise = false,
}: {
  diffText: string;
  maxLines?: number;
  hideTruncationNote?: boolean;
  denoise?: boolean;
}) {
  const { lines, truncated } = useMemo(
    () => parseDiff(diffText, maxLines, denoise),
    [diffText, maxLines, denoise],
  );
  if (lines.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Only HTML/markup differences, nothing meaningful to display.
      </p>
    );
  }
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "remove").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-center gap-3", eyebrowClass("micro"))}>
        {added > 0 && <span className="text-positive">+ {added} added</span>}
        {removed > 0 && <span className="text-critical">− {removed} removed</span>}
      </div>
      <ul className="flex flex-col gap-1 text-dense leading-relaxed">
        {lines.map((l, i) => (
          <li
            key={i}
            className={cn(
              "px-2 py-1 rounded-sm font-normal flex gap-2",
              l.kind === "add" && "bg-positive/[0.08] text-foreground",
              l.kind === "remove" && "bg-critical/[0.08] text-foreground",
            )}
          >
            <span
              className={cn(
                "font-mono shrink-0 select-none",
                l.kind === "add" ? "text-positive" : "text-critical",
              )}
            >
              {l.kind === "add" ? "+" : "−"}
            </span>
            <span className="break-words min-w-0">{l.text}</span>
          </li>
        ))}
      </ul>
      {truncated && !hideTruncationNote && (
        <p className={eyebrowClass("micro")}>… more changes truncated</p>
      )}
    </div>
  );
}
