"use client";

import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import type { ActionStatus } from "@/lib/api";
import { ACTION_OPTIONS, SNOOZE_PRESETS } from "@/lib/signal-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * The list column's fixed foot. At rest it teaches the keyboard model; the moment
 * rows are selected it becomes the bulk bar in the same strip, so acting on a
 * selection never pushes the list around.
 */
export function SignalsListFooter({
  selectedCount,
  onBulkMarkRead,
  onBulkTrack,
  onBulkSnooze,
  onBulkDismiss,
  onClearSelection,
  onShowShortcuts,
}: {
  selectedCount: number;
  onBulkMarkRead: (read: boolean) => void;
  onBulkTrack: (status: ActionStatus | null) => void;
  onBulkSnooze: (ms: number) => void;
  onBulkDismiss: () => void;
  onClearSelection: () => void;
  onShowShortcuts: () => void;
}) {
  if (selectedCount > 0) {
    return (
      <div className="flex shrink-0 items-center gap-1 border-t border-border bg-surface-2 px-3 py-1.5">
        <span className="text-dense font-medium">
          <span className="tabular-nums">{selectedCount}</span> selected
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => onBulkMarkRead(true)}
        >
          <Check size={13} /> Read
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More bulk actions">
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => onBulkMarkRead(false)}>
              Mark unread
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Track
            </DropdownMenuLabel>
            {ACTION_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} onSelect={() => onBulkTrack(o.value)}>
                {o.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Snooze
            </DropdownMenuLabel>
            {SNOOZE_PRESETS.map((p) => (
              <DropdownMenuItem key={p.label} onSelect={() => onBulkSnooze(p.ms)}>
                {p.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onBulkDismiss}>
              Dismiss as noise
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="sm" className="h-7" onClick={onClearSelection}>
          Clear
        </Button>
      </div>
    );
  }

  return (
    // Hover-capable devices only: a touch user has no keyboard to teach.
    <div className="hidden shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-meta text-muted-foreground [@media(hover:hover)]:flex">
      <Hint keys={["J", "K"]}>Move</Hint>
      <Hint keys={["R"]}>Read</Hint>
      <Hint keys={["X"]}>Select</Hint>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onShowShortcuts}
        className="inline-flex items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
      >
        <Kbd>?</Kbd> Shortcuts
        <ChevronDown size={11} className="rotate-180 opacity-60" aria-hidden />
      </button>
    </div>
  );
}

function Hint({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="ml-0.5">{children}</span>
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-4 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 py-px font-mono text-meta text-foreground">
      {children}
    </kbd>
  );
}
