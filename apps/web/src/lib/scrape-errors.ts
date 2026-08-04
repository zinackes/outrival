// Maps raw scraper/worker error strings (persisted in monitors.lastError) to
// human-readable messages for the dashboard. UI-only — the worker keeps storing
// the technical detail; this just renders something a user can act on instead of
// dumps like "No candidate path succeeded for <url> (tried /pricing, …): undefined".

const PAGE_LABEL: Record<string, string> = {
  homepage: "homepage",
  pricing: "pricing page",
  blog: "blog",
  changelog: "changelog",
  jobs: "careers page",
  g2_reviews: "G2 reviews page",
  capterra_reviews: "Capterra reviews page",
  appstore_reviews: "App Store page",
  shopify_reviews: "Shopify App Store page",
  linkedin: "LinkedIn page",
  twitter: "X / Twitter page",
};

/** What to call the page a source is supposed to watch ("careers page", "blog", …). */
export function sourcePageLabel(sourceType?: string): string {
  return (sourceType && PAGE_LABEL[sourceType]) ?? "page";
}

export function friendlyScrapeError(
  raw: string | null | undefined,
  sourceType?: string,
): string {
  const page = sourcePageLabel(sourceType);
  if (!raw) return "The scrape failed after several retries. We'll try again automatically.";

  const e = raw.toLowerCase();

  // Roadmap portals: three outcomes that are facts about the competitor, not scrape
  // failures. The Sources page reads them as "not available" (NO_TARGET_MARKERS in
  // @outrival/shared); without these branches the same monitor read "The scrape
  // failed unexpectedly" everywhere else it surfaces.
  if (e.includes("no_roadmap_portal")) {
    return "We couldn't find a public roadmap or feedback portal for this competitor. If they have one, point us at it in the monitor settings.";
  }
  if (e.includes("portal_private")) {
    return "This roadmap portal is private, so there's nothing public to collect.";
  }
  if (e.includes("portal_empty")) {
    return "This roadmap portal is public but has no entries yet. We'll pick them up as they're posted.";
  }

  // The crawler walked a list of known paths (e.g. /pricing, /tarifs, /plans) and none worked.
  if (e.includes("no candidate path succeeded")) {
    return `Couldn't find a ${page} on this site. None of the usual URLs responded.`;
  }

  // A URL that doesn't match the expected shape (e.g. App Store links).
  if (e.includes("not a valid")) {
    return "This URL doesn't look right for this source. Double-check it in the monitor settings.";
  }

  // Collection doctrine: the site explicitly refused us (block / challenge / robots
  // Disallow) and we STOPPED — we don't bypass a refusal. robots.txt gets its own
  // honest message; any other refusal shares one. handleRefusal stores
  // "refused: <reason>", so these match first.
  if (e.includes("robots_disallowed")) {
    return `This site's robots.txt asks automated crawlers not to collect this ${page}, so we don't.`;
  }
  if (e.includes("refused")) {
    return "This site doesn't allow automated collection, so we don't monitor this source.";
  }

  // Anti-bot protection — the site served a block/challenge. Under the doctrine we
  // treat that as a refusal and don't work around it, so the source isn't collected.
  if (
    e.includes("cloudflare") ||
    e.includes("cloudflare_challenge") ||
    e.includes("captcha") ||
    e.includes("access denied") ||
    e.includes("blocked_403") ||
    e.includes("blocked_503") ||
    e.includes("soft_block") ||
    e.includes("403")
  ) {
    return "This site doesn't allow automated access, so we don't collect this page.";
  }

  // L0 fetched HTML but the page needs a browser to render and the cascade still
  // couldn't capture usable content.
  if (e.includes("needs_render")) {
    return `Couldn't load the ${page}: it needs a browser to render and we couldn't capture it.`;
  }

  // The URL returned an HTTP error (404 not found, 410 gone, 401/451 gated, 5xx) —
  // the page doesn't exist at this address, as opposed to an anti-bot block. Common
  // when a URL lost its `www` (an apex host that 404s sub-paths) or the page moved.
  if (e.includes("http_error")) {
    return `The ${page} URL returned an error. It may have moved or no longer exists. Check the URL in the monitor settings.`;
  }

  // Domain unreachable / DNS.
  if (
    e.includes("enotfound") ||
    e.includes("err_name_not_resolved") ||
    e.includes("getaddrinfo") ||
    e.includes("dns")
  ) {
    return "Couldn't reach the site. The domain may be down or misconfigured.";
  }

  // Connection refused / reset mid-request, or a generic network failure from the
  // cascade (failureReason "network_error").
  if (
    e.includes("econnrefused") ||
    e.includes("econnreset") ||
    e.includes("err_connection") ||
    e.includes("network_error")
  ) {
    return "The site refused the connection.";
  }

  // Slow / hung responses.
  if (e.includes("timeout") || e.includes("timed out")) {
    return "The site took too long to respond and the scrape timed out.";
  }

  // TLS issues.
  if (e.includes("err_cert") || e.includes("certificate")) {
    return "The site has an invalid SSL certificate, so we couldn't load it securely.";
  }

  // Generic cascade failures: "scraping_failed" / "static_scraping_failed".
  if (e.includes("scraping failed") || e.includes("scraping_failed")) {
    return `Couldn't load the ${page}.`;
  }

  // Unknown — show a clean fallback rather than a raw URL/stack dump.
  return "The scrape failed unexpectedly. We'll try again automatically.";
}
