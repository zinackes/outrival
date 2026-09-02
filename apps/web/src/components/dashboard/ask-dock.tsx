"use client";

import * as React from "react";
import { SparkleIcon } from "@/components/icons";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AskPanel } from "./ask-panel";
import { useAskContext } from "./ask-context";

/** Opens the contextual Ask sheet from anywhere (the topbar button, ⌘J). The
 *  event's `detail.question`, when present, lands in the textarea. */
export const ASK_OPEN_EVENT = "outrival-ask-open";

// "Ask Outrival" as a right-side sheet, pre-scoped to the page's entity
// (Linear's inline-agent pattern). It used to carry its own floating Iris
// button, which put a second permanent entry point for a feature the topbar
// already names, in the one corner that covers the content — the support-widget
// silhouette this product's design explicitly rejects. The sheet stays; it is
// opened by the topbar button and ⌘J.
export function AskDock() {
  const entity = useAskContext();
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen(e: Event) {
      const q = (e as CustomEvent<{ question?: unknown }>).detail?.question;
      setPrefill(typeof q === "string" ? q : null);
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener(ASK_OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(ASK_OPEN_EVENT, onOpen);
    };
  }, []);

  const context = entity
    ? { label: entity.label, competitorId: entity.competitorId, kind: entity.kind }
    : null;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // Cleared on close so the same question can be handed in again later.
          if (!o) setPrefill(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <SparkleIcon className="size-4 text-[var(--link)]" aria-hidden />
              Ask Outrival
            </SheetTitle>
            <SheetDescription>
              Answered from your own tracked data.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            <AskPanel embedded context={context} initialQuestion={prefill} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
