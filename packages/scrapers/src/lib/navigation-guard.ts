import { validatePublicUrl } from "@outrival/shared";
import type { BrowserContext } from "playwright";

/**
 * Redirect hops one render may follow before the page is refused. The upfront check
 * (crawler.ts's assertScrapableUrl) validates where we AIM the browser; nothing
 * validated where the page then sends it.
 */
export const MAX_RENDER_REDIRECTS = 5;

export type RouteAction = "abort" | "continue";

/** The parts of a Playwright Request this policy reads. */
export interface RoutedRequest {
  resourceType: string;
  url: string;
  isNavigation: boolean;
  isRedirect: boolean;
}

/**
 * Policy for one render's intercepted requests — stateful only in its redirect
 * count. Split from the Playwright handler so it is testable without a browser.
 *
 * The fetch paths re-run `validatePublicUrl` on every hop (safeFetch, sendWebhook).
 * The render path validated `page.goto`'s target and nothing after it, so an HTTP
 * 30x, a meta refresh or a `location =` on the monitored page steered the headless
 * browser at the worker box's own network — cloud metadata, a localhost service —
 * with no check at all (code:SEC-14). Syntactic only, same contract as
 * `validatePublicUrl`: a public hostname resolving to a private IP stays an
 * egress-layer concern.
 *
 * Subresources are not host-checked. They never become the snapshot, and a real
 * product page legitimately loads assets from hosts we know nothing about; only
 * `blockedTypes` (a bandwidth concern, not a security one) applies to them.
 */
export function createRouteGate(
  blockedTypes: ReadonlySet<string> = new Set(),
): (req: RoutedRequest) => RouteAction {
  let redirects = 0;
  return (req) => {
    if (blockedTypes.has(req.resourceType)) return "abort";
    if (!req.isNavigation) return "continue";
    if (req.isRedirect && ++redirects > MAX_RENDER_REDIRECTS) return "abort";
    return validatePublicUrl(req.url).ok ? "continue" : "abort";
  };
}

/**
 * Install {@link createRouteGate} on a browser context. ONE handler per context:
 * a second `context.route("**\/*")` takes precedence over this one and would
 * silently reopen the hole, so callers that also block resource types pass their
 * set here instead of registering their own route.
 */
export async function installNavigationGuard(
  context: BrowserContext,
  blockedTypes?: ReadonlySet<string>,
): Promise<void> {
  const gate = createRouteGate(blockedTypes);
  await context.route("**/*", (route) => {
    const request = route.request();
    const action = gate({
      resourceType: request.resourceType(),
      url: request.url(),
      isNavigation: request.isNavigationRequest(),
      isRedirect: request.redirectedFrom() !== null,
    });
    return action === "abort" ? route.abort() : route.continue();
  });
}
