/**
 * Display labels for platform_profile slugs (patch-31). The profile stores routable
 * slugs (`slug(d.tech)` in @outrival/scrapers platform/detect.ts: "Next.js" → "next",
 * "Google Analytics" → "google-analytics"). User-facing surfaces (the Compare "Stack"
 * row, the competitor platform tab) want the proper brand name back.
 *
 * Keys mirror the slugs of HOUSE_TECHNOLOGIES + the routed ATS providers. Kept here
 * (not in @outrival/scrapers) so the API/web can import it without pulling the scraper
 * deps — monorepo rule: api → shared only. Unknown slugs fall back to a title-case.
 */
const PLATFORM_LABELS: Record<string, string> = {
  // Web frameworks
  next: "Next.js",
  nuxt: "Nuxt.js",
  remix: "Remix",
  sveltekit: "SvelteKit",
  gatsby: "Gatsby",
  astro: "Astro",
  // CMS / site builders
  wordpress: "WordPress",
  webflow: "Webflow",
  framer: "Framer",
  ghost: "Ghost",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  // Hosting / CDN
  vercel: "Vercel",
  netlify: "Netlify",
  cloudflare: "Cloudflare",
  fastly: "Fastly",
  "aws-cloudfront": "AWS CloudFront",
  // Analytics
  "google-analytics": "Google Analytics",
  posthog: "PostHog",
  segment: "Segment",
  mixpanel: "Mixpanel",
  amplitude: "Amplitude",
  plausible: "Plausible",
  // ATS providers (the "<provider>:<token>" routing-key prefix)
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
  workable: "Workable",
  personio: "Personio",
};

/** "next" → "Next.js"; an unknown "foo-bar" → "Foo Bar". */
export function platformLabel(slug: string): string {
  const known = PLATFORM_LABELS[slug.toLowerCase()];
  if (known) return known;
  return slug
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
