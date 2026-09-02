"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A meter needs a name. Radix renders role="progressbar", which a screen reader
 * announces as a bare "progressbar 62%" unless something labels it — and every one
 * of these sat next to its label as a plain sibling <span>, so 36 nodes across the
 * usage, notifications, products and billing settings were unnamed (`ux:35`, axe
 * aria-progressbar-name).
 *
 * The name is REQUIRED in the type rather than asked for in a comment: an unnamed
 * meter now fails typecheck instead of shipping and being found by a crawl.
 */
type ProgressProps = React.ComponentProps<typeof ProgressPrimitive.Root> &
  ({ "aria-label": string } | { "aria-labelledby": string });

function Progress({ className, value, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        // bg-track, not primary/20: a 20% accent gutter measured 1.3:1 against the
        // card, so an empty bar was invisible and a 5% bar unreadable.
        "relative h-2 w-full overflow-hidden rounded-full bg-track",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
