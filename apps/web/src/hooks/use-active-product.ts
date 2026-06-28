"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

// patch-28 — the active product scope. Page-level consumers read it from the URL
// (?product=), but a plain <Link> drops the query param, so switching pages used to
// lose the scope. The switcher persists it to localStorage so the scope survives
// navigation onto param-less routes (a competitor detail page) and reloads; the
// sidebar reads this to keep the switcher in sync, to thread ?product= back onto its
// nav links, and to restore the param on a bare scope-aware route.
export const ALL_PRODUCTS = "all";
const STORAGE_KEY = "outrival:activeProduct";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// No scope on the server / first paint — localStorage is client-only.
function getServerSnapshot(): null {
  return null;
}

/**
 * Persist (or clear with `null` / "all") the active product. Notifies every
 * `useActiveProduct` reader in this tab so the sidebar reacts immediately, not just
 * on the next navigation. Called by the product switcher.
 */
export function persistActiveProduct(value: string | null) {
  try {
    if (value && value !== ALL_PRODUCTS) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — scope falls back to the URL only */
  }
  listeners.forEach((l) => l());
}

/**
 * The persisted scope alone (null = none). Used by the reconciliation effect that
 * needs to know the remembered scope independently of the current URL param.
 */
export function useStoredProduct(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The effective active product id (null = all products). The URL ?product= wins (it
 * is the explicit current scope that page consumers read), falling back to the
 * persisted value so a route that doesn't carry the param still knows the scope.
 * Storage is written only by the switcher (`persistActiveProduct`) — never mirrored
 * from a lagging URL param — so clearing to "all" can't be clobbered by a race.
 */
export function useActiveProduct(): string | null {
  const param = useSearchParams().get("product");
  const stored = useStoredProduct();
  return param ?? stored;
}
