import { scrapePage, scrapeFirstSuccess } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";
import {
  detectAtsBoard,
  fetchAtsJobs,
  appendAtsJobsToHtml,
  atsBoardFromKey,
  type AtsBoard,
  type AtsJob,
} from "./ats";
import { findCareersLink } from "./careers-link";

// patch-31 — synthesise a jobs snapshot straight from the ATS API result, no
// browser scrape. Deterministic (appendAtsJobsToHtml sorts) so the content hash is
// stable, and the JSON island feeds extract-jobs exactly like the appended path.
function atsOnlyOutcome(url: string, board: AtsBoard, jobs: AtsJob[]): ScrapeOutcome {
  const base = "<!doctype html><html><head><title>Open roles</title></head><body></body></html>";
  const jobsText = jobs
    .map((j) => [j.title, j.department, j.location].filter(Boolean).join(" — "))
    .join("\n");
  return {
    html: appendAtsJobsToHtml(base, board, jobs),
    text: jobsText,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url, scrapedWith: "ats-api", atsDetected: board.provider, atsJobs: jobs.length },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}

const CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/join-us",
  "/carrieres",
  "/career",
  "/about/careers",
  "/company/careers",
  "/work-with-us",
  // FR — many French sites use these instead of the English paths.
  "/recrutement",
  "/nous-rejoindre",
  "/rejoignez-nous",
  "/emploi",
];

const CAREERS_KEYWORDS = [
  "careers",
  "carrieres",
  "jobs",
  "join-us",
  "join_us",
  "recrutement",
  "nous-rejoindre",
  "rejoignez",
  "emploi",
];

// Minimum text on a followed off-site careers page to prefer it over `result`.
// A jobs listing is short next to a marketing homepage, so this is just a "did we
// actually get a page, not an empty SPA shell" floor — not a richness contest.
const MIN_CAREERS_HOP_TEXT = 200;

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  // patch-31 — when platform detection already resolved the ATS board, fetch the
  // postings straight from the public API and synthesise the snapshot, skipping the
  // careers-page discovery render entirely. Falls through to the full scrape when
  // there's no ATS in the profile, or the API yields nothing (down / migration —
  // the careers HTML then re-detects the board today, and triggers re-detection).
  const atsKey = options.platformProfile?.ats?.value;
  if (atsKey) {
    const board = atsBoardFromKey(atsKey);
    if (board) {
      const jobs = await fetchAtsJobs(board);
      if (jobs) return atsOnlyOutcome(url, board, jobs);
    }
  }

  const lowered = url.toLowerCase();
  const direct = CAREERS_KEYWORDS.some((k) => lowered.includes(k));

  const pageOpts = {
    fullPage: true,
    knownLevel: options.knownLevel,
  };
  let result: ScrapeOutcome;
  if (direct) {
    result = await scrapePage(url, pageOpts);
  } else {
    try {
      result = await scrapeFirstSuccess(url, CAREERS_PATHS, (u) => scrapePage(u, pageOpts));
    } catch {
      // No same-host careers page — scrape the homepage anyway so we can still
      // discover an off-site careers link (footer "Nous rejoindre" → external site).
      result = await scrapePage(url, pageOpts);
    }
  }

  // Most competitors host their openings on an ATS (Greenhouse, Lever, Ashby, …)
  // linked/embedded from the careers page — scraping the page alone misses them.
  const board = detectAtsBoard(result.html);
  if (board) {
    // Phase A — pull the postings from the ATS public JSON API and append them to
    // the snapshot (visible list for change detection + JSON island for a
    // structured, LLM-free job_postings update downstream).
    const jobs = await fetchAtsJobs(board);
    if (jobs) {
      const jobsText = jobs
        .map((j) => [j.title, j.department, j.location].filter(Boolean).join(" — "))
        .join("\n");
      return {
        ...result,
        html: appendAtsJobsToHtml(result.html, board, jobs),
        text: `${result.text}\n${jobsText}`,
        metadata: { ...result.metadata, atsDetected: board.provider, atsJobs: jobs.length },
      };
    }

    // Phase B — no usable API (Workable, fetch failed, empty board): follow the
    // board link one hop so the worker LLM-extracts from the real listing page
    // instead of the marketing careers page. Fail-soft: keep the careers page.
    try {
      const hop = await scrapePage(board.boardUrl, pageOpts);
      if (hop.text.length > result.text.length) {
        return {
          ...hop,
          metadata: { ...hop.metadata, atsDetected: board.provider, atsFollowed: board.boardUrl },
        };
      }
    } catch {
      // ignore — fall through to the careers page below
    }
    return { ...result, metadata: { ...result.metadata, atsDetected: board.provider } };
  }

  // No known ATS — the openings may live on a custom, external careers site
  // linked from the nav/footer ("Nous rejoindre" → a separate jobs site, e.g.
  // Welcome to the Jungle). Follow that link one cross-host hop; the downstream
  // LLM extracts the listing. Same-host links are already covered by the path
  // discovery above, so only an off-site hop is worth the extra scrape.
  //
  // Keep the hop whenever it returns real content (floor) rather than requiring
  // it to beat `result`: `result` is often the marketing homepage, which has far
  // more raw text than a jobs listing yet zero openings — comparing lengths would
  // wrongly discard the page that actually has the jobs. Fail-soft: keep `result`.
  const finalUrl = (typeof result.metadata.url === "string" && result.metadata.url) || url;
  const careersLink = findCareersLink(result.html, finalUrl);
  if (careersLink) {
    try {
      if (new URL(careersLink).hostname !== new URL(finalUrl).hostname) {
        const hop = await scrapePage(careersLink, pageOpts);
        if (hop.text.length > MIN_CAREERS_HOP_TEXT) {
          return { ...hop, metadata: { ...hop.metadata, careersFollowed: careersLink } };
        }
      }
    } catch {
      // ignore — fall through to the original page
    }
  }
  return result;
}
