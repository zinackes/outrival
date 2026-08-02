import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { LAST_REVIEWED } from "@/components/landing/compare/data";

const SITE_URL = "https://outrival.app";

// The editorial review date the comparison pages already print on themselves.
// One constant for the page and its sitemap entry, so the two can never disagree.
const COMPARE_REVIEWED = new Date(`${LAST_REVIEWED} UTC`);

// `lastModified` is a CLAIM, and Google treats it as one: Gary Illyes has said
// the signal is binary per site — a sitemap whose URLs all carry today's date is
// read as unreliable and lastmod is then discarded site-wide. This file used to
// stamp `new Date()` on all 29 URLs at build time, i.e. exactly that pattern.
//
// So: a date here is the date the PAGE'S CONTENT last changed, written by hand.
// Bump it when you change the page. If you don't know, leave it off — an omitted
// lastmod costs nothing, a wrong one costs the whole signal.
//
// `changefreq` and `priority` are gone for the same reason with none of the
// upside: Google has said for years that it ignores both, so all they did was
// assert a ranking order for our own pages that nothing reads.
//
// Only pages worth a crawler's time are listed. The boilerplate legal set
// (/dpa, /legal-notice, /subprocessors, /cookies, /acceptable-use,
// /terms-of-sale, /accessibility) stays indexable and stays linked from the
// footer — it is simply not ADVERTISED here. Eleven of the twenty-nine URLs we
// were submitting were legal text, which is what a sitemap is worst at: it tells
// Google what we consider our best pages.
const ROUTES: Array<{ path: string; lastModified?: Date }> = [
  { path: "/", lastModified: new Date("2026-07-24") },
  { path: "/pricing", lastModified: new Date("2026-08-01") },
  // The proof page — a real digest, readable without signing up. It is the
  // landing's own "see the product" destination, so it belongs near the top.
  { path: "/sample", lastModified: new Date("2026-07-28") },
  { path: "/vs/crayon", lastModified: COMPARE_REVIEWED },
  { path: "/vs/klue", lastModified: COMPARE_REVIEWED },
  { path: "/vs/diy", lastModified: COMPARE_REVIEWED },
  { path: "/alternatives/crayon", lastModified: COMPARE_REVIEWED },
  { path: "/alternatives/klue", lastModified: COMPARE_REVIEWED },
  {
    path: "/alternatives/best-competitive-intelligence-tools",
    lastModified: COMPARE_REVIEWED,
  },
  { path: "/about", lastModified: new Date("2026-07-24") },
  { path: "/blog", lastModified: latestPostDate() },
  { path: "/demo", lastModified: new Date("2026-07-28") },
  // Both render live data, so any date we wrote here would be stale the moment
  // the page changed on its own. Omitted rather than guessed.
  { path: "/changelog" },
  { path: "/status" },
  { path: "/docs", lastModified: new Date("2026-07-24") },
  { path: "/security", lastModified: new Date("2026-07-24") },
  // The crawler's own page — the UA string points here, so site owners who look
  // us up in their logs must be able to find it.
  { path: "/bot", lastModified: new Date("2026-07-24") },
  { path: "/legal", lastModified: new Date("2026-07-23") },
  { path: "/privacy", lastModified: new Date("2026-07-24") },
  { path: "/terms", lastModified: new Date("2026-07-24") },
];

function latestPostDate(): Date | undefined {
  const dates = getAllPosts().map((p) => new Date(`${p.date}T00:00:00Z`));
  return dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : undefined;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = ROUTES.map((route) => ({
    url: route.path === "/" ? SITE_URL : `${SITE_URL}${route.path}`,
    ...(route.lastModified ? { lastModified: route.lastModified } : {}),
  }));

  // One entry per published article, stamped with its own publish date — the one
  // lastmod on this site that is true by construction.
  const blogRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.date}T00:00:00Z`),
  }));

  return [...staticRoutes, ...blogRoutes];
}
