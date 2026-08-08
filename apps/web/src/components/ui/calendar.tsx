"use client";

import * as React from "react";
import { CaretLeftIcon, CaretRightIcon } from "@/components/icons";
import { DayPicker, type DayButtonProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// shadcn new-york calendar, adapted to react-day-picker v10.
//
// v10 splits a day in two: the selection modifiers (selected / range_start /
// range_middle / range_end) land on the CELL (<td>), while the number is a
// nested <button>. A text colour set on the cell therefore always loses to the
// button's own, so every state below is expressed ON THE BUTTON through
// mutually exclusive data attributes. The attributes are computed so no two can
// style the same property at once (a selected day is never also `outside`,
// today's ring is dropped under a fill) — otherwise which one wins would depend
// on the order Tailwind happens to emit the utilities in, not on intent.
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      {...props}
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "relative flex w-full flex-col gap-4",
        month_caption: "flex h-8 items-center justify-center px-8",
        caption_label: "text-sm font-medium text-foreground",
        nav: "absolute inset-x-0 top-0 z-20 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 p-0 text-foreground",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 p-0 text-foreground",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-xs font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        // The cell is layout only — see the note above.
        day: "relative h-9 w-9 p-0 text-center focus-within:relative focus-within:z-20",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...rest }) => {
          const Icon = orientation === "left" ? CaretLeftIcon : CaretRightIcon;
          return <Icon className={cn("size-4", chevronClassName)} {...rest} />;
        },
        DayButton: CalendarDayButton,
        ...props.components,
      }}
    />
  );
}

function CalendarDayButton({ className, day, modifiers, ...props }: DayButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  // A range of one day is both its start and its end: keep it fully rounded
  // rather than square on both sides.
  const isWholeRange = modifiers.range_start && modifiers.range_end;

  return (
    <button
      ref={ref}
      data-today={(modifiers.today && !modifiers.selected) || undefined}
      data-outside={(modifiers.outside && !modifiers.selected) || undefined}
      data-filled={(modifiers.selected && !modifiers.range_middle) || undefined}
      data-range-middle={modifiers.range_middle || undefined}
      data-range-start={(!isWholeRange && modifiers.range_start) || undefined}
      data-range-end={(!isWholeRange && modifiers.range_end) || undefined}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-md text-sm font-normal text-foreground",
        "outline-none transition-colors hover:bg-surface-3",
        "focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        // Leading/trailing days of the neighbouring months recede, but stay
        // above the AA floor — they are still clickable targets.
        "data-[outside=true]:text-muted-foreground",
        // Today, while unselected: a ring, never a fill.
        "data-[today=true]:font-medium data-[today=true]:ring-1 data-[today=true]:ring-border-strong data-[today=true]:ring-inset",
        // Inside the range: a tint that reads as a band, distinct from hover.
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-primary/15 data-[range-middle=true]:hover:bg-primary/25",
        // Both ends of the range (and a single picked day): the accent fill,
        // with the one label colour that actually reads on it.
        "data-[filled=true]:bg-primary data-[filled=true]:font-medium data-[filled=true]:text-primary-foreground data-[filled=true]:hover:bg-primary",
        // Squared off where the band continues.
        "data-[range-start=true]:rounded-r-none data-[range-end=true]:rounded-l-none",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar };
