import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

// Outer frame shared by every competitor tab: a single card whose blocks are
// separated by dividers, so each tab opens identically (a framed card with a
// section heading) and never nests cards within cards.
export function TabCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col divide-y divide-border overflow-hidden rounded-lg", className)}>
      {children}
    </Card>
  );
}

// One block inside a TabCard. An optional heading gives the section a readable
// title; blocks are padded uniformly and separated by the card's dividers.
// No icon slot: an icon beside every heading turns a dense analytical page into a
// sticker sheet, and none of them carried meaning the words did not already.
export function TabSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 p-5", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && (
            <h3 className="text-content font-semibold leading-tight tracking-tight">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * An absence, in the same card as the sections but not shaped like one.
 *
 * A block that says "nothing found here yet" was reading exactly like a block that
 * says something: a heading at section weight, a paragraph at section padding, the
 * same divider above and below. Four of those on one page made a filled product
 * look unfinished. An absence is an inset band at a third of the height, its label
 * inline with its note, and it never carries a heading. What it says stays honest
 * and specific ("no recognizable tech in the last scan", never "coming soon"), and
 * `action` names the thing that would fill it, when there is one.
 */
export function TabAbsence({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface-2 px-5 py-3">
      <p className="m-0 max-w-[75ch] text-dense text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        {children != null && (
          <>
            <span aria-hidden className="mx-1.5 text-border-strong">
              ·
            </span>
            {children}
          </>
        )}
      </p>
      {action}
    </div>
  );
}
