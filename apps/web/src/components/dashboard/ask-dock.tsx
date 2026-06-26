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

// Ambient "Ask Outrival" launcher: a floating Iris button + ⌘J open the assistant as a
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
          title="Ask Outrival  (⌘J)"
          className="fixed bottom-5 right-5 z-40 inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-e3 transition-colors duration-150 ease-out hover:bg-accent-bright focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px active:bg-accent-dim"
        >
          <Sparkles className="size-5" aria-hidden />
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
