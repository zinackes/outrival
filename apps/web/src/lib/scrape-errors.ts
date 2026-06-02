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
  linkedin: "LinkedIn page",
  twitter: "X / Twitter page",
};

export function friendlyScrapeError(
  raw: string | null | undefined,
  sourceType?: string,
): string {
  const page = (sourceType && PAGE_LABEL[sourceType]) ?? "page";
  if (!raw) return "The scrape failed after several retries — we'll try again automatically.";

  const e = raw.toLowerCase();

  // The crawler walked a list of known paths (e.g. /pricing, /tarifs, /plans) and none worked.
  if (e.includes("no candidate path succeeded")) {
    return `Couldn't find a ${page} on this site — none of the usual URLs responded.`;
  }

  // A URL that doesn't match the expected shape (e.g. App Store links).
  if (e.includes("not a valid")) {
    return "This URL doesn't look right for this source — double-check it in the monitor settings.";
  }

  // Anti-bot protection — the scraping cascade (patch-20) exhausted every level
  // (direct → Patchright → datacenter → residential → Camoufox) and stayed blocked.
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
    return "The site is blocking automated access, so we couldn't read the page.";
  }

  // L0 fetched HTML but the page needs a browser to render and the cascade still
  // couldn't capture usable content.
  if (e.includes("needs_render")) {
    return `Couldn't load the ${page} — it needs a browser to render and we couldn't capture it.`;
  }

  // Domain unreachable / DNS.
  if (
    e.includes("enotfound") ||
    e.includes("err_name_not_resolved") ||
    e.includes("getaddrinfo") ||
    e.includes("dns")
  ) {
    return "Couldn't reach the site — the domain may be down or misconfigured.";
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
  return "The scrape failed unexpectedly — we'll try again automatically.";
}
