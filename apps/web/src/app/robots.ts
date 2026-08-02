import type { MetadataRoute } from "next";

const SITE_URL = "https://outrival.app";

// One rule set for every crawler, Google's and the AI engines' alike. We do not
// disallow GPTBot / ClaudeBot / PerplexityBot: being un-crawlable by them is
// being un-citable by them, and an answer engine that never reads the site
// cannot name it.
//
// Careful with Cloudflare: its "Managed robots.txt" toggle (AI Crawl Control)
// injects AI-bot Disallow rules ABOVE this file and cannot be overridden from
// here. If AI crawlers stop showing up in the logs, check that toggle first.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        // No trailing slash: the bare /dashboard entry point was crawlable.
        "/dashboard",
        "/auth",
        "/dev/",
        "/onboarding",
        "/admin",
        // Capability URLs — a public share link and a generated brief. Both
        // already send `noindex`, but a crawler has to fetch a page to read
        // that, and these are unguessable one-off documents worth nobody's
        // crawl budget.
        "/report/",
        "/brief/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
