"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// shadcn new-york calendar, adapted to react-day-picker v10 class-name keys.
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "relative flex w-full flex-col gap-4",
        month_caption: "flex h-8 items-center justify-center px-8",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 z-20 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-xs font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: cn(
          "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:bg-accent/60",
          "[&:has([aria-selected].range-end)]:rounded-r-md",
          "[&:has([aria-selected].range-start)]:rounded-l-md",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-9 rounded-md p-0 font-normal transition-colors",
          "hover:bg-accent hover:text-foreground",
          "aria-selected:opacity-100",
        ),
        range_start:
          "range-start rounded-l-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        range_end:
          "range-end rounded-r-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        range_middle:
          "rounded-none bg-accent text-foreground hover:bg-accent hover:text-foreground",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "rounded-md font-medium text-foreground ring-1 ring-inset ring-border-strong",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...rest }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon className={cn("size-4", chevronClassName)} {...rest} />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
