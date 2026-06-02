import { scrapePage, scrapeFirstSuccess } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";

const CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/join-us",
  "/carrieres",
  "/career",
  "/about/careers",
  "/company/careers",
  "/work-with-us",
];

const CAREERS_KEYWORDS = ["careers", "carrieres", "jobs", "join-us", "join_us"];

const ATS_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "greenhouse", regex: /(boards\.greenhouse\.io|greenhouse\.io\/embed)/i },
  { name: "lever", regex: /(jobs\.lever\.co|lever\.co\/postings)/i },
  { name: "ashby", regex: /(jobs\.ashbyhq\.com|ashbyhq\.com\/api)/i },
  { name: "workable", regex: /(apply\.workable\.com|workable\.com\/api)/i },
  { name: "recruitee", regex: /(\.recruitee\.com)/i },
  { name: "smartrecruiters", regex: /(jobs\.smartrecruiters\.com)/i },
];

function detectAts(html: string): string | null {
  for (const { name, regex } of ATS_PATTERNS) {
    if (regex.test(html)) return name;
  }
  return null;
}

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const lowered = url.toLowerCase();
  const direct = CAREERS_KEYWORDS.some((k) => lowered.includes(k));

  const pageOpts = {
    fullPage: true,
    knownLevel: options.knownLevel,
  };
  const result = direct
    ? await scrapePage(url, pageOpts)
    : await scrapeFirstSuccess(url, CAREERS_PATHS, (u) => scrapePage(u, pageOpts));

  const ats = detectAts(result.html);
  return {
    ...result,
    metadata: { ...result.metadata, atsDetected: ats },
  };
}
