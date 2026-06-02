import type { MetadataRoute } from "next";

const SITE_URL = "https://outrival.io";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard/", "/auth"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
