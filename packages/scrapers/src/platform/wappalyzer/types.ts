/**
 * Wappalyzer-compatible fingerprint format (patch-31). We DON'T vendor the
 * enthec/webappanalyzer dataset (GPL-3.0 — incompatible with this proprietary
 * codebase); instead the engine reads this neutral format and we ship a small
 * house-authored dataset (`technologies.ts`) in the exact same shape. If a
 * permissively-licensed dataset is adopted later it drops in unchanged.
 *
 * Pattern strings follow Wappalyzer's convention: a regex optionally followed by
 * `\;`-separated tags, e.g. `"Ghost(?:\\s([\\d.]+))?\\;version:\\1\\;confidence:50"`.
 * An empty string means "presence only" (the key existing is the match). See
 * `engine.ts#parsePattern`.
 */

export interface TechFingerprint {
  /** Category ids (see `categories.ts`) — map a tech to a profile field. */
  cats: number[];
  /** Response header name → value pattern (empty = present). */
  headers?: Record<string, string>;
  /** Cookie name → value pattern (empty = present). */
  cookies?: Record<string, string>;
  /** `<meta name|property>` → content pattern. */
  meta?: Record<string, string>;
  /** Global JS variable name → pattern (rendered page only, step B). */
  js?: Record<string, string>;
  /** Regex patterns tested against the raw HTML. */
  html?: string[];
  /** Regex patterns tested against each `<script src>` URL. */
  scriptSrc?: string[];
  /** DNS patterns — only CNAME is consumed here. */
  dns?: { CNAME?: string[] };
  /** Other techs this one implies (transitively added with reduced confidence). */
  implies?: string[];
  website?: string;
}

/** Technology display-name → fingerprint. */
export type TechCatalog = Record<string, TechFingerprint>;

export interface CategoryDef {
  name: string;
  /** Which PlatformProfile field a detection in this category populates. */
  profileField: "framework" | "cms" | "hosting" | "cdn" | "analytics";
}

/** Category id → definition. */
export type CategoryCatalog = Record<number, CategoryDef>;
