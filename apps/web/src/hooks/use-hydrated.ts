"use client";

import { useEffect, useState } from "react";

/**
 * False on the server and on the first client render, true from the effect after it.
 *
 * The switch for `onClock` (`@/lib/hydration-clock`): render the server-derivable
 * value while this is false, so hydration finds the markup it expects, then the
 * viewer's own once it flips — one extra render, before anything is interactive.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
