"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AskPanel } from "./ask-panel";
import { useAskContext } from "./ask-context";

// Ambient "Ask Outrival" launcher: a floating pill + ⌘J open the assistant as a
// right-side sheet from anywhere, pre-scoped to the page's entity (Linear's
// inline-agent pattern). Hidden on the dedicated /dashboard/ask page (redundant).
export function AskDock() {
  const pathname = usePathname();
  const entity = useAskContext();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onAskPage = pathname === "/dashboard/ask";
  const context = entity
    ? { label: entity.label, competitorId: entity.competitorId, kind: entity.kind }
    : null;

  return (
    <>
      {!onAskPage && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Outrival"
          className="fixed bottom-5 right-5 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Sparkles className="size-4 text-[var(--link)]" aria-hidden />
          Ask
          <kbd className="ml-0.5 hidden h-5 select-none items-center rounded border border-border bg-background px-1.5 font-mono text-meta font-medium leading-none text-muted-foreground sm:inline-flex">
            ⌘J
          </kbd>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-[var(--link)]" aria-hidden />
              Ask Outrival
            </SheetTitle>
            <SheetDescription>
              Answered from your own tracked data.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <AskPanel embedded context={context} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
