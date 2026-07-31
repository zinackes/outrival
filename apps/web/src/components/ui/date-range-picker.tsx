"use client";

import * as React from "react";
import { CalendarBlankIcon, CheckIcon, CaretDownIcon, CaretRightIcon } from "@/components/icons";
import { endOfDay, format, isBefore, isSameDay, startOfDay, subDays } from "date-fns";
import type { DateRange as RdpDateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DatePreset {
  label: string;
  range: () => DateRange;
}

// Rolling "last N days" window ending now (start-of-day .. end-of-day bounds).
export function lastNDays(n: number): DateRange {
  return { from: startOfDay(subDays(new Date(), n)), to: endOfDay(new Date()) };
}

export const DEFAULT_PRESETS: DatePreset[] = [
  { label: "Last 7 days", range: () => lastNDays(7) },
  { label: "Last 30 days", range: () => lastNDays(30) },
  { label: "Last 90 days", range: () => lastNDays(90) },
];

// "All time" — a fixed early start so the window spans the org's full history
// (product data never predates this). Only for pages that pass {from,to} straight
// through to a query; pages that render "last N days" labels should NOT use it.
export const ALL_TIME_START = new Date(2000, 0, 1);

export const ALL_TIME_PRESET: DatePreset = {
  label: "All time",
  range: () => ({ from: ALL_TIME_START, to: endOfDay(new Date()) }),
};

function rangesMatch(a: DateRange, b: DateRange): boolean {
  return isSameDay(a.from, b.from) && isSameDay(a.to, b.to);
}

function triggerLabel(value: DateRange, presets: DatePreset[]): string {
  for (const p of presets) {
    if (rangesMatch(value, p.range())) return p.label;
  }
  const sameYear = value.from.getFullYear() === value.to.getFullYear();
  return `${format(value.from, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(value.to, "MMM d, yyyy")}`;
}

// shadcn-only date-range picker: a popover lists the fixed presets (7/30/90),
// and "Custom range" opens a nested popover whose Calendar flies out to the side
// (auto-flips left/right) without changing the list. The calendar lives in a
// Popover (not a Menu) so chevrons and day clicks stay fully interactive; an
// interact-outside guard keeps the outer popover open while picking a range.
// Picking dates never closes anything: the range commits as soon as both ends
// are set, and the popover stays up until the user dismisses it. Only a preset,
// which is a whole choice in one click, closes the list.
// Emits concrete {from,to} dates so every call site shares one model.
export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = "end",
  className,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
  presets?: DatePreset[];
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<RdpDateRange | undefined>(undefined);
  const calRef = React.useRef<HTMLDivElement>(null);

  // Value is custom when it matches none of the fixed presets.
  const isCustom = !presets.some((p) => rangesMatch(value, p.range()));

  // On open, reflect the current value: a custom range reveals the calendar.
  React.useEffect(() => {
    if (open) setCustomOpen(isCustom);
  }, [open]);

  // Opening the flyout shows the range in effect; the next click starts a new one.
  // Keyed on the timestamps, not the Date objects: a call site that rebuilds its
  // range each render would otherwise reseed the draft on every render.
  const fromTs = value.from.getTime();
  const toTs = value.to.getTime();
  React.useEffect(() => {
    if (customOpen) setDraft({ from: new Date(fromTs), to: new Date(toTs) });
  }, [customOpen, fromTs, toTs]);

  // react-day-picker EXTENDS whatever range it is handed, so being fed a complete
  // {from,to} made every single click produce another complete range: the picker
  // committed and closed on the first day clicked, and a range could never be
  // drawn. Drive the two clicks here instead, off the day that was actually
  // clicked, and never close on our own — the popover stays up until dismissed.
  function applyCalendar(_next: RdpDateRange | undefined, clicked: Date) {
    if (!draft?.from || draft.to) {
      setDraft({ from: clicked, to: undefined });
      return;
    }
    const backwards = isBefore(clicked, draft.from);
    const from = backwards ? clicked : draft.from;
    const to = backwards ? draft.from : clicked;
    setDraft({ from, to });
    onChange({ from: startOfDay(from), to: endOfDay(to) });
  }

  const itemClass = (active: boolean) =>
    cn(
      "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-dense transition-colors",
      active
        ? "bg-accent/50 text-foreground"
        : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)}>
          <CalendarBlankIcon size={16} />
          {triggerLabel(value, presets)}
          <CaretDownIcon size={16} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="flex w-44 flex-col gap-0.5 p-1.5"
        // Keep the list open while interacting with the portaled calendar flyout.
        onInteractOutside={(e) => {
          const target = e.detail.originalEvent.target as Node | null;
          if (target && calRef.current?.contains(target)) e.preventDefault();
        }}
      >
        {presets.map((p) => {
          const active = rangesMatch(value, p.range());
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(p.range());
                setOpen(false);
              }}
              className={itemClass(active)}
            >
              {p.label}
              {active && <CheckIcon size={16} />}
            </button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={itemClass(isCustom || customOpen)}>
              <span className="flex items-center gap-2">
                Custom range
                {isCustom && <CheckIcon size={16} />}
              </span>
              <CaretRightIcon size={16} className="text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            ref={calRef}
            side="right"
            align="start"
            sideOffset={10}
            className="w-auto p-0"
          >
            <Calendar
              mode="range"
              defaultMonth={draft?.from ?? value.from}
              selected={draft}
              onSelect={applyCalendar}
              numberOfMonths={1}
            />
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}
