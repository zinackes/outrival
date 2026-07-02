"use client";

import { useEffect } from "react";

// Progressive scroll reveal for the landing. Selects every [data-reveal] section
// and fades+rises it into view once. The hidden start state is applied here (in an
// effect, client-only) rather than in SSR CSS, so:
//   - pages render fully with JS disabled (no permanently-hidden content), and
//   - only below-the-fold sections carry [data-reveal], so adding the hidden class
//     after mount never causes a visible flash (they're already off-screen).
// Respects prefers-reduced-motion by doing nothing.
export function ScrollReveal() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const els = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (els.length === 0) return;

    els.forEach((el) => el.classList.add("reveal-init"));

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
