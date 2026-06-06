"use client";

import * as React from "react";
import { CalendarIcon, Check, ChevronDown, ChevronRight } from "lucide-react";
import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns";
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
  const calRef = React.useRef<HTMLDivElement>(null);

  // Value is custom when it matches none of the fixed presets.
  const isCustom = !presets.some((p) => rangesMatch(value, p.range()));

  // On open, reflect the current value: a custom range reveals the calendar.
  React.useEffect(() => {
    if (open) setCustomOpen(isCustom);
  }, [open]);

  function applyCalendar(r: RdpDateRange | undefined) {
    // Only commit (and close everything) once both ends are picked.
    if (r?.from && r?.to) {
      onChange({ from: startOfDay(r.from), to: endOfDay(r.to) });
      setOpen(false);
    }
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
          <CalendarIcon size={13} />
          {triggerLabel(value, presets)}
          <ChevronDown size={13} className="text-muted-foreground" />
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
              {active && <Check size={14} />}
            </button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={itemClass(isCustom || customOpen)}>
              <span className="flex items-center gap-2">
                Custom range
                {isCustom && <Check size={14} />}
              </span>
              <ChevronRight size={14} className="text-muted-foreground" />
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
              defaultMonth={value.from}
              selected={{ from: value.from, to: value.to }}
              onSelect={applyCalendar}
              numberOfMonths={1}
            />
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}
