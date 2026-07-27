"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A disclosure whose open/closed state outlives the page load, kept in
 * localStorage: collapsing a section is a preference about the page, not a
 * per-visit accident, and re-opening it on every navigation reads as the app
 * forgetting what it was told.
 *
 * Read on mount rather than during render — localStorage does not exist on the
 * server, so a lazy initialiser would make the first client render disagree with
 * the markup that was sent.
 */
export function usePersistedOpen(key: string, initial = true) {
  const [open, setOpen] = useState(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "0" || raw === "1") setOpen(raw === "1");
    } catch {
      // A blocked or full store only costs the memory of the preference.
    }
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Same: the section still opens and closes, it just won't be remembered.
      }
    },
    [key],
  );

  return [open, set] as const;
}
