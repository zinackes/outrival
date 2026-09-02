"use client";

import { CheckIcon, MinusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The selection column's box, used both by a list header (select-all) and by every row.
 * Always rendered, always a tab stop: a checkbox that only exists on hover can't be
 * found by a keyboard, and can't be found at all on a touch screen, which is what made
 * the whole roster look like it had no selection at all.
 *
 * `mixed` is the header's third state — some rows selected, not all — and maps to
 * aria-checked="mixed", the value a screen reader needs to not announce a partial
 * selection as a complete one.
 */
export function SelectBox({
  checked,
  mixed,
  label,
  onToggle,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onToggle: (e: React.MouseEvent) => void;
}) {
  const on = checked || mixed === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => {
        // The row is navigated by a stretched link covering it; this box sits above
        // that overlay, so the click must not also reach it.
        e.preventDefault();
        e.stopPropagation();
        onToggle(e);
      }}
      className={cn(
        "relative z-10 flex size-4 shrink-0 items-center justify-center rounded-sm border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        // A 16px box is a 16px target. The pseudo-element pushes the hit area out to
        // a 32px square without moving the box or the column it sits in.
        "after:absolute after:-inset-2",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-stroke text-transparent hover:border-foreground/50",
      )}
    >
      {mixed ? <MinusIcon size={16} /> : <CheckIcon size={16} />}
    </button>
  );
}
