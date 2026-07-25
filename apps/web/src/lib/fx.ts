"use client";

import { useEffect, useState } from "react";

/**
 * Best-effort FX rates (units of each currency per 1 USD) from the ECB via
 * frankfurter.dev — no API key, CORS-enabled (`access-control-allow-origin: *`).
 * The legacy api.frankfurter.app host now 301-redirects here, and a cross-origin
 * redirect breaks the browser CORS fetch, so we hit the .dev host directly.
 *
 * Cached at module scope and shared across every reader on the page, so the
 * pricing tab and the compare lens pay for one fetch between them. A failure
 * (offline, blocked, unsupported currency) leaves the rates null and every caller
 * falls back to reading captured numbers rather than inventing a converted one.
 */
export interface FxData {
  rates: Record<string, number>;
  /** Rate date as published by the ECB, e.g. "2026-07-24". */
  date: string;
}

let fxCache: FxData | null = null;
let fxPromise: Promise<FxData | null> | null = null;

export function loadFx(): Promise<FxData | null> {
  if (fxCache) return Promise.resolve(fxCache);
  if (fxPromise) return fxPromise;
  fxPromise = fetch("https://api.frankfurter.dev/v1/latest?base=USD")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { rates?: Record<string, number>; date?: string } | null) => {
      if (!d?.rates) return null;
      fxCache = { rates: { USD: 1, ...d.rates }, date: d.date ?? "" };
      return fxCache;
    })
    .catch(() => null);
  return fxPromise;
}

export function useFx(): FxData | null {
  const [fx, setFx] = useState<FxData | null>(fxCache);
  useEffect(() => {
    if (fx) return;
    let alive = true;
    void loadFx().then((r) => {
      if (alive) setFx(r);
    });
    return () => {
      alive = false;
    };
  }, [fx]);
  return fx;
}

/**
 * Convert an amount between currencies using USD-based rates; null when either
 * currency is missing from the rate table (or rates haven't loaded yet).
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null,
): number | null {
  if (from === to) return amount;
  const rf = rates?.[from];
  const rt = rates?.[to];
  if (!rf || !rt) return null;
  return (amount * rt) / rf;
}

/** "24 Jul 2026" — how the rate date reads in a footnote. */
export function fxDateLabel(date: string): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
