import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

const SITE_URL = "https://outrival.app";

// Public, indexable routes only. Private areas (/dashboard, /auth, /admin,
// /onboarding, /api, /dev) are excluded here and disallowed in robots.ts.
const ROUTES: Array<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  // The proof page — a real digest, readable without signing up. It is the
  // landing's own "see the product" destination, so it belongs near the top.
  { path: "/sample", changeFrequency: "monthly", priority: 0.9 },
  { path: "/vs/crayon", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/klue", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/diy", changeFrequency: "monthly", priority: 0.8 },
  { path: "/alternatives/crayon", changeFrequency: "monthly", priority: 0.7 },
  { path: "/alternatives/klue", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/alternatives/best-competitive-intelligence-tools",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { path: "/about", changeFrequency: "monthly", priority: 0.7 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.7 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.8 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.6 },
  { path: "/docs", changeFrequency: "monthly", priority: 0.5 },
  { path: "/status", changeFrequency: "daily", priority: 0.4 },
  { path: "/security", changeFrequency: "yearly", priority: 0.4 },
  // The crawler's own page — the UA string points here, so site owners who look
  // us up in their logs must be able to find it.
  { path: "/bot", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/dpa", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal-notice", changeFrequency: "yearly", priority: 0.3 },
  { path: "/subprocessors", changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
  { path: "/acceptable-use", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms-of-sale", changeFrequency: "yearly", priority: 0.3 },
  { path: "/accessibility", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = ROUTES.map((route) => ({
    url: route.path === "/" ? SITE_URL : `${SITE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // One entry per published article, stamped with its own publish date.
  const blogRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.date}T00:00:00Z`),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...blogRoutes];
}
