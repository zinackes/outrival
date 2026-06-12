"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// One row = one shortcut. Keys render as <kbd> chips; a row can list alternates.
const GROUPS: { label: string; rows: { keys: string[]; action: string }[] }[] = [
  {
    label: "Navigate",
    rows: [
      { keys: ["j", "↓"], action: "Next signal" },
      { keys: ["k", "↑"], action: "Previous signal" },
      { keys: ["Enter"], action: "Open competitor · expand a group" },
      { keys: ["Esc"], action: "Release focus · close this" },
    ],
  },
  {
    label: "Act on the focused signal",
    rows: [
      { keys: ["r"], action: "Mark read / unread" },
      { keys: ["t"], action: "Track (set action status)" },
      { keys: ["c"], action: "Discuss (toggle comments)" },
    ],
  },
  {
    label: "Filter & find",
    rows: [
      { keys: ["1", "–", "6"], action: "Switch view tab" },
      { keys: ["/"], action: "Search signals" },
      { keys: ["?"], action: "Show this help" },
    ],
  },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-meta text-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Triage the feed without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-2 font-mono text-meta uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <div
                    key={row.action}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-foreground">{row.action}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k) =>
                        k === "–" ? (
                          <span
                            key={k}
                            className="text-meta text-muted-foreground"
                          >
                            –
                          </span>
                        ) : (
                          <Kbd key={k}>{k}</Kbd>
                        ),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
