"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

// Page-open reveal — a gentle fade as a new dashboard SECTION opens. Keyed by the
// first-level segment (not the full pathname): navigating within a section — e.g.
// between two competitor detail pages — no longer remounts the whole subtree, which
// used to drop state, re-run effects, resubscribe TanStack observers and repaint at
// opacity 0 for the full duration. Reduced-motion users get no motion (globals.css
// neutralizes animate-in).
export function PageReveal({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return (
    <div key={segment ?? "index"} className="animate-in fade-in duration-200">
      {children}
    </div>
  );
}
