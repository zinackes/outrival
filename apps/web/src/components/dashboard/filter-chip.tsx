"use client";

import { XIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * One active filter, shown as a removable chip under the toolbar that set it.
 *
 * The chip is what keeps a filter from being invisible: a menu the user closed
 * still governs the page, and a page quietly showing a subset of the data reads as
 * a page missing data. The children carry the filter's own encoding — a category's
 * ink, a competitor's favicon — so a value picked in the menu looks the same once
 * picked as it did while picking.
 */
export function FilterChip({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onRemove}
            className="ml-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Remove filter"
          >
            <XIcon size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Remove filter</TooltipContent>
      </Tooltip>
    </span>
  );
}
