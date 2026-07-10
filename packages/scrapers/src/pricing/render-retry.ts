import { harvestPricing } from "./harvest";

/** True when an L0 (no-browser) pricing capture shows no harvestable price at all —
 * the signature of a client-rendered pricing page (SSR shell, JS-mounted price
 * cards). One browser render then reveals what L0 structurally cannot see. Never
 * true for browser-level captures: if L1+ saw no prices, rendering again won't help. */
export function needsRenderRetry(html: string, level: number): boolean {
  if (level !== 0) return false;
  return harvestPricing(html).plans.length === 0;
}
