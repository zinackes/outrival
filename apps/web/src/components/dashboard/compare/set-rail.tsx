"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckIcon, PlusIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { competitorNameColor } from "@/lib/competitor-color";
import { feedItemTransition, feedItemVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { YouTag, type CompareEntity } from "./lens";

/**
 * The compared set, made visible. It used to live only in the table's own headers,
 * with a remove-X that appeared on hover, so the one thing the page is *about* — who
 * is in this comparison — could not be read at a glance or edited without hunting.
 */

/** A selectable entity: one of the org's own products, or a competitor. */
export interface PickEntity {
  id: string;
  name: string;
  kind: "you" | "competitor";
  color: string | null;
  url: string | null;
}

function Chip({
  entity,
  onRemove,
}: {
  entity: CompareEntity;
  onRemove: () => void;
}) {
  return (
    <motion.span
      layout
      variants={feedItemVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={feedItemTransition}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md border py-0 pr-1 pl-1.5 text-dense",
        entity.mine
          ? "border-primary/45 bg-primary/[0.07]"
          : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      <CompAvatar name={entity.name} url={entity.url} size={18} />
      <span
        className="max-w-[10rem] truncate font-medium"
        style={entity.mine ? undefined : competitorNameColor(entity.color)}
      >
        {entity.name}
      </span>
      {entity.mine && <YouTag />}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entity.name} from the comparison`}
        className="text-muted-foreground hover:bg-surface-3 hover:text-foreground focus-visible:ring-ring/50 grid size-4 place-items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <XIcon size={16} />
      </button>
    </motion.span>
  );
}

function PickItem({
  entity,
  on,
  full,
  onToggle,
}: {
  entity: PickEntity;
  on: boolean;
  full: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <CommandItem
      value={entity.name}
      disabled={!on && full}
      onSelect={() => {
        if (on || !full) onToggle(entity.id);
      }}
      className="gap-2"
    >
      <CheckIcon size={16} className={cn(on ? "opacity-100" : "opacity-0")} />
      <CompAvatar name={entity.name} url={entity.url} size={18} />
      <span className="truncate">{entity.name}</span>
    </CommandItem>
  );
}

export function CompareSetRail({
  chips,
  pickYou,
  pickComps,
  selectedIds,
  maxCompetitors,
  maxTotal,
  onToggle,
}: {
  /** In display order — your products first, then the competitors. */
  chips: CompareEntity[];
  pickYou: PickEntity[];
  pickComps: PickEntity[];
  selectedIds: Set<string>;
  /** Competitor slots. Your own products share the roster but don't consume one. */
  maxCompetitors: number;
  /** Ceiling on the whole set, matching the API's column cap. Bites only on multi-SKU. */
  maxTotal: number;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const usedComps = pickComps.reduce((n, e) => (selectedIds.has(e.id) ? n + 1 : n), 0);
  const atTotal = selectedIds.size >= maxTotal;
  const compsFull = atTotal || usedComps >= maxCompetitors;

  return (
    <div className="border-border flex flex-wrap items-center gap-1.5 border-b pb-4">
      <AnimatePresence initial={false} mode="popLayout">
        {chips.map((c) => (
          <Chip key={c.id} entity={c} onRemove={() => onToggle(c.id)} />
        ))}
      </AnimatePresence>

      {/* Stays enabled at the cap so the picker can still be opened to deselect —
          only adding is blocked, per item. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground border-border-strong h-7 border border-dashed"
          >
            <PlusIcon size={16} />
            Add
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Search to compare…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              {pickYou.length > 0 && (
                <CommandGroup heading="Your products">
                  {pickYou.map((e) => (
                    <PickItem
                      key={e.id}
                      entity={e}
                      on={selectedIds.has(e.id)}
                      full={atTotal}
                      onToggle={onToggle}
                    />
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading="Competitors">
                {pickComps.map((e) => (
                  <PickItem
                    key={e.id}
                    entity={e}
                    on={selectedIds.has(e.id)}
                    full={compsFull}
                    onToggle={onToggle}
                  />
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <span className="text-muted-foreground ml-0.5 text-meta tabular-nums">
        {usedComps}/{maxCompetitors}
      </span>
    </div>
  );
}
