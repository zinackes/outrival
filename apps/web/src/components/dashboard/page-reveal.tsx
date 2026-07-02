"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// Page-open reveal — a gentle fade + rise, generalized from the effect the
// competitor detail view played on its content container. Keyed by pathname so
// the animation replays every time a new dashboard page is opened. Reduced-motion
// users get the content with no motion (globals.css neutralizes animate-in).
export function PageReveal({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div
      key={pathname}
      className="animate-in fade-in slide-in-from-bottom-2 duration-500"
    >
      {children}
    </div>
  );
}
