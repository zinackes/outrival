// Navigation wait strategy (F6, docs/optimization-audit-2026-06.md).
//
// `networkidle` waits for 500 ms of network silence, which never arrives on pages
// with analytics / polling / ads / chat widgets — so it always burns the full
// navigation timeout (~30 s) before proceeding, turning fast pages slow and
// turning successful scrapes into spurious `timeout` failures. Instead we navigate
// with `domcontentloaded` and then do a BOUNDED best-effort settle: late
// XHR/hydration gets a short window (SCRAPE_SETTLE_MS), then we proceed with
// whatever loaded. Unlike `networkidle`, this can never hang. The existing
// waitForSelector / progressiveScroll (homepage) / anti-void guards cover any
// genuinely lazy content.
//
// Kill-switch: SCRAPE_WAIT_NETWORKIDLE=true restores the legacy behavior exactly
// (networkidle goto, no settle), so a regression on a specific source can be
// reverted without a code change. Read at call time on purpose — flippable per
// deploy and unit-testable.

export function navWaitUntil(): "networkidle" | "domcontentloaded" {
  return process.env.SCRAPE_WAIT_NETWORKIDLE === "true" ? "networkidle" : "domcontentloaded";
}

/**
 * Bounded settle after a `domcontentloaded` navigation. No-op in legacy
 * networkidle mode (the goto already waited). Best-effort: a settle timeout or
 * failure must never lose the page we already navigated to.
 */
export async function settleAfterNav(page: {
  waitForLoadState(state: "networkidle", opts: { timeout: number }): Promise<unknown>;
}): Promise<void> {
  if (process.env.SCRAPE_WAIT_NETWORKIDLE === "true") return;
  const settleMs = Number(process.env.SCRAPE_SETTLE_MS ?? 2500);
  await page.waitForLoadState("networkidle", { timeout: settleMs }).catch(() => {});
}
