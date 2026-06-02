import * as cheerio from "cheerio";
import {
  TECH_CATALOG,
  type TechCategory,
  type ImportanceLevel,
} from "./catalog";

export interface DetectedTech {
  techId: string;
  name: string;
  category: TechCategory;
  importance: ImportanceLevel;
  evidence: string[]; // where each match came from (script:… / header:… / dom:… / footer:…)
}

export interface TechStackInput {
  url: string;
  html: string;
  // Response headers, names already lower-cased (HTTP header names are
  // case-insensitive; the scraper normalises them so detectors can index directly).
  responseHeaders: Record<string, string>;
  scriptUrls: string[]; // <script src> URLs extracted from the page
}

/**
 * Pure tech-stack detection over already-fetched evidence (headers + script URLs
 * + raw HTML). No I/O — the scraper does the fetching, this only matches the
 * catalog so it stays unit-testable against HTML fixtures. A tech is reported
 * once, with every distinct piece of evidence that matched it.
 */
export function detectTechStack(input: TechStackInput): DetectedTech[] {
  // Parse the footer once (not per-catalog-entry) — only when at least one
  // signature actually looks at footer keywords.
  let footerText: string | null = null;
  const footerTextLazy = (): string => {
    if (footerText === null) {
      try {
        const $ = cheerio.load(input.html);
        footerText = $("footer").text().toLowerCase();
      } catch {
        footerText = "";
      }
    }
    return footerText;
  };

  const detected: DetectedTech[] = [];

  for (const tech of TECH_CATALOG) {
    const evidence: string[] = [];

    // 1. Script URLs
    if (tech.detectors.scriptUrls) {
      for (const scriptUrl of input.scriptUrls) {
        if (tech.detectors.scriptUrls.some((p) => p.test(scriptUrl))) {
          evidence.push(`script:${scriptUrl}`);
          break; // one script proof is enough; don't list every CDN variant
        }
      }
    }

    // 2. Response headers
    if (tech.detectors.headers) {
      for (const { name, value } of tech.detectors.headers) {
        const headerValue = input.responseHeaders[name.toLowerCase()];
        if (headerValue !== undefined && value.test(headerValue)) {
          evidence.push(`header:${name}=${headerValue}`);
        }
      }
    }

    // 3. DOM patterns (raw HTML)
    if (tech.detectors.domPatterns) {
      for (const pattern of tech.detectors.domPatterns) {
        if (pattern.test(input.html)) {
          evidence.push(`dom:${pattern.source}`);
        }
      }
    }

    // 4. Footer keywords
    if (tech.detectors.footerKeywords) {
      const footer = footerTextLazy();
      if (footer) {
        for (const kw of tech.detectors.footerKeywords) {
          if (footer.includes(kw.toLowerCase())) {
            evidence.push(`footer:${kw}`);
          }
        }
      }
    }

    if (evidence.length > 0) {
      detected.push({
        techId: tech.id,
        name: tech.name,
        category: tech.category,
        importance: tech.importance,
        evidence,
      });
    }
  }

  return detected;
}
