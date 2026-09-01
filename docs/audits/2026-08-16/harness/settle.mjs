/**
 * Wait until a page has finished rendering, for crawl purposes.
 *
 * `networkidle` is unusable on this app: notifications-bell.tsx opens an
 * EventSource inside the dashboard shell, so an authenticated page keeps a
 * connection open forever and the network never goes quiet. Every goto() would
 * burn its full timeout and, worse, a screenshot taken at that point still shows
 * loading skeletons that an agent would report as a broken page.
 *
 * Settling is therefore read from the DOM: data fetching is TanStack Query, and
 * it renders shadcn skeletons (`data-slot="skeleton"`) while in flight.
 */
export async function settle(page, { timeout = 12_000 } = {}) {
  await page.waitForLoadState("load", { timeout }).catch(() => {});
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-slot="skeleton"]').length === 0,
      null,
      { timeout },
    )
    .catch(() => {});
  // Small tail for post-fetch layout shifts (charts, images, font swap).
  await page.waitForTimeout(500);
}
