"use client";

import { useEffect, useState } from "react";

/**
 * Returns the timestamp (ms) of the PREVIOUS visit to `key`, then records the
 * current moment as the latest visit. `null` on the first ever visit. Lets a
 * surface highlight "new since your last visit" with no server state — purely
 * client/localStorage. Read once on mount so the highlight is stable for the
 * session (it doesn't clear as you read).
 */
export function useLastVisit(key: string): number | null {
  const [previous, setPrevious] = useState<number | null>(null);

  useEffect(() => {
    const storageKey = `outrival:lastVisit:${key}`;
    try {
      const raw = localStorage.getItem(storageKey);
      setPrevious(raw ? Number(raw) : null);
      localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      setPrevious(null);
    }
  }, [key]);

  return previous;
}
