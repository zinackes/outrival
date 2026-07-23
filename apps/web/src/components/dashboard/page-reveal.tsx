"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

// Page-open reveal — a gentle fade as a new dashboard SECTION opens. Keyed by the
// first-level segment (not the full pathname): navigating within a section — e.g.
// between two competitor detail pages — no longer remounts the whole subtree, which
// used to drop state, re-run effects, resubscribe TanStack observers and repaint at
// opacity 0 for the full duration. Reduced-motion users get no motion (globals.css
// neutralizes animate-in).
export function PageReveal({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  // Signals is a full-bleed workspace (dashboard-shell hands it the viewport): this
  // wrapper must fill the bounded #main-content flex column so the view's own h-full
  // and its inner overflow-y-auto columns resolve, instead of growing to content and
  // getting clipped. Every other route stays a normal, page-scrolling document.
  const fullBleed = segment === "signals";
  return (
    <div
      key={segment ?? "index"}
      className={cn(
        "animate-in fade-in duration-200",
        fullBleed && "flex min-h-0 flex-1 flex-col",
      )}
    >
      {children}
    </div>
  );
}
