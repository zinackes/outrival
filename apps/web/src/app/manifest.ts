import type { MetadataRoute } from "next";

// Web app manifest (Next.js file convention → injects <link rel="manifest">).
// Fills the "no manifest" SEO gap: gives the browser a branded name, theme, and
// icons. Icons reference the dynamic app/icon + app/apple-icon routes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Outrival — Automated competitive intelligence",
    short_name: "Outrival",
    description:
      "Outrival monitors your competitors continuously and ships a strategic AI digest every week. Hosted in the EU.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
