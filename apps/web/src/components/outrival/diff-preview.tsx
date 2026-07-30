"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { splitDiffText } from "@outrival/shared";
import { eyebrowClass } from "@/components/outrival/eyebrow";

export type DiffLine = { kind: "add" | "remove"; text: string };

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
 */
export function parseDiff(
  diffText: string,
  maxLines = 18,
): { lines: DiffLine[]; truncated: boolean } {
  const { removed, added } = splitDiffText(diffText);

  const clean = (block: string[]) =>
    block.map((raw) => stripHtml(raw).trim()).filter((text) => text.length > 0);
  const addedLines = clean(added);
  const removedLines = clean(removed);

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
}: {
  diffText: string;
  maxLines?: number;
  hideTruncationNote?: boolean;
}) {
  const { lines, truncated } = useMemo(
    () => parseDiff(diffText, maxLines),
    [diffText, maxLines],
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
