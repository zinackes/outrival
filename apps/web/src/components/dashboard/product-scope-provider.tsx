"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { productsListQuery } from "@/lib/queries";
import {
  ALL_PRODUCTS,
  normalizeScope,
  PRODUCT_COOKIE,
  PRODUCT_COOKIE_MAX_AGE,
} from "@/lib/product-scope";

// The active product scope, mirrored client-side. Seeded by the server (which reads
// the cookie during render), so the first client paint already knows the scope and
// matches the server-seeded React Query cache — no flash. The switcher writes the
// cookie + this state; readers get the live value without waiting for navigation.

interface ScopeCtx {
  // The persisted scope (cookie-backed). null = all products. Does NOT factor in the
  // URL override — `useProductScope()` layers that on for page consumers.
  stored: string | null;
  setScope: (value: string | null) => void;
}

const Ctx = React.createContext<ScopeCtx | null>(null);

function writeCookie(value: string | null) {
  if (typeof document === "undefined") return;
  const v = normalizeScope(value);
  if (!v) {
    document.cookie = `${PRODUCT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } else {
    document.cookie = `${PRODUCT_COOKIE}=${v}; path=/; max-age=${PRODUCT_COOKIE_MAX_AGE}; SameSite=Lax`;
  }
}

export function ProductScopeProvider({
  initial,
  children,
}: {
  initial: string | null;
  children: React.ReactNode;
}) {
  const [stored, setStored] = React.useState<string | null>(
    normalizeScope(initial),
  );

  // Persist + update state only. Navigation/refresh is the caller's concern (the
  // switcher collapses the URL override or refreshes server components), so calling
  // this from an effect can't trigger a navigation loop.
  const setScope = React.useCallback((value: string | null) => {
    const next = normalizeScope(value);
    setStored(next);
    writeCookie(next);
  }, []);

  // Self-heal a stale/foreign scope: the cookie is a global browser preference (not
  // org-scoped), so a product id persisted while signed into another org — or one
  // since deleted — otherwise sticks and filters every product-scoped feed down to
  // nothing, with no escape hatch on a mono-product org (the switcher is hidden).
  // Once the org's real products load, drop a scope that isn't among them back to All
  // products (clears the cookie). Deduped with the sidebar's identical query.
  const productsQ = useQuery(productsListQuery());
  React.useEffect(() => {
    const products = productsQ.data;
    if (!products || stored === null) return;
    if (!products.some((p) => p.id === stored)) setScope(null);
  }, [productsQ.data, stored, setScope]);

  const value = React.useMemo<ScopeCtx>(
    () => ({ stored, setScope }),
    [stored, setScope],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useScopeCtx(): ScopeCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("useProductScope must be used within <ProductScopeProvider>");
  }
  return ctx;
}

/**
 * The effective active product id (null = all products). The URL ?product= wins (an
 * explicit, shareable deep-link), falling back to the persisted cookie-backed scope.
 */
export function useProductScope(): string | null {
  const param = normalizeScope(useSearchParams().get("product"));
  const { stored } = useScopeCtx();
  return param ?? stored;
}

/** The persisted scope alone, ignoring any URL override. */
export function useStoredScope(): string | null {
  return useScopeCtx().stored;
}

/** Persist (or clear with null / "all") the active product. */
export function useSetProductScope(): (value: string | null) => void {
  return useScopeCtx().setScope;
}

export { ALL_PRODUCTS };
