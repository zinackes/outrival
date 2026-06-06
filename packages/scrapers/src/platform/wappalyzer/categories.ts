import type { CategoryCatalog } from "./types";

/**
 * Category ids reuse Wappalyzer's well-known numbers (so a future permissive
 * dataset lines up) but only the handful we route on. `profileField` maps a
 * category to the PlatformProfile field a detection populates.
 */
export const CATEGORIES: CategoryCatalog = {
  1: { name: "CMS", profileField: "cms" },
  10: { name: "Analytics", profileField: "analytics" },
  12: { name: "JavaScript framework", profileField: "framework" },
  18: { name: "Web framework", profileField: "framework" },
  31: { name: "CDN", profileField: "cdn" },
  62: { name: "PaaS / hosting", profileField: "hosting" },
};
