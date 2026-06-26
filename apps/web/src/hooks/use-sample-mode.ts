"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// Sample / demo mode (Step 0 cold-start): lets a fresh user explore the
// interface against realistic data before adding a real competitor — NN/g's
// "demo data for safe exploration". Client-only, never touches the API, so no
// data is ever written. Persisted in sessionStorage and shared across routes
// (Overview, Signals, competitor detail) via a tiny external store so toggling
// it on one surface flips them all in the same tab.

const KEY = "outrival:sample";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Cross-tab + cross-component coherence.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useSampleMode(): readonly [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribe,
    read,
    () => false, // server snapshot — sample mode is client-only
  );

  // Re-sync once on mount in case sessionStorage was set before hydration.
  useEffect(() => emit(), []);

  const set = useCallback((next: boolean) => {
    try {
      if (next) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore — private mode / disabled storage */
    }
    emit();
  }, []);

  return [on, set] as const;
}
