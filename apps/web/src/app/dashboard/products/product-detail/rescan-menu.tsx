"use client";

import { useState } from "react";
import {
  CaretDownIcon,
  CircleNotchIcon,
  ClockIcon,
  ArrowsClockwiseIcon,
} from "@phosphor-icons/react/ssr";
import type { MyProductRescanCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export const RESCAN_CATEGORIES: { key: MyProductRescanCategory; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "pricing", label: "Pricing" },
  { key: "features", label: "Features" },
  { key: "techStack", label: "Tech stack" },
  { key: "jobs", label: "Hiring" },
];

/** Re-scan control with selective targets. Picking cards re-scans only their sources
 * (Features + Tech stack share one homepage scrape server-side); "Everything" re-scans
 * every card shown here (homepage, pricing, jobs).
 * Shown for live products; repo/idea stages use a plain button. */
export function RescanMenu({
  busy,
  queued = false,
  onRescan,
}: {
  busy: boolean;
  /** Requested, no scanner on it yet. Not the same claim as "Scanning…". */
  queued?: boolean;
  onRescan: (categories?: MyProductRescanCategory[]) => void;
}) {
  const [selected, setSelected] = useState<Set<MyProductRescanCategory>>(new Set());
  const toggle = (key: MyProductRescanCategory) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || queued}>
          {busy ? (
            <CircleNotchIcon className="size-3.5 animate-spin" />
          ) : queued ? (
            <ClockIcon className="size-3.5" />
          ) : (
            <ArrowsClockwiseIcon className="size-3.5" />
          )}
          {busy ? "Scanning…" : queued ? "Queued" : "Re-scan"}
          <CaretDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Re-scan only</DropdownMenuLabel>
        {RESCAN_CATEGORIES.map((cat) => (
          <DropdownMenuCheckboxItem
            key={cat.key}
            checked={selected.has(cat.key)}
            onCheckedChange={() => toggle(cat.key)}
            onSelect={(e) => e.preventDefault()}
          >
            {cat.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem
          disabled={selected.size === 0}
          onSelect={() => {
            onRescan([...selected]);
            setSelected(new Set());
          }}
        >
          Re-scan selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRescan(RESCAN_CATEGORIES.map((c) => c.key))}>
          Everything
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
