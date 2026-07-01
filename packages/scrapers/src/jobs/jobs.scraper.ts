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

  // Careers / job-board pages routinely inject their openings CLIENT-SIDE (the SSR
  // HTML carries only a "Loading open positions…" placeholder). That HTML is still
  // text-rich (marketing copy, team, culture), so L0's needs_render guard accepts
  // it and the browser is never used → the roles are invisible. When JOBS_RENDER_
  // ENABLED (default on), render the pages we COMMIT to (the found careers page,
  // followed board/off-site hops) at L1 and scroll so the bounded settle catches
  // the openings XHR. Path PROBING stays cheap L0 (most candidates 404) — only the
  // page we keep pays a render. Kill-switch off ⇒ exactly the previous behaviour.
  const renderJobs = process.env.JOBS_RENDER_ENABLED !== "false";
  // Jobs parse HTML/JSON only — no screenshot needed; drop media/font bandwidth.
  const probeOpts = { blockResources: true, knownLevel: options.knownLevel };
  const renderPage = (u: string) =>
    scrapePage(u, renderJobs ? { ...probeOpts, render: true, progressiveScroll: true } : probeOpts);

  let result: ScrapeOutcome;
  let onCareersPage: boolean; // false ⇒ the homepage fallback, not a careers page
  let rendered = false; // did `result` already come from a browser render?
  if (direct) {
    // The monitor URL is itself a careers URL → render it straight away.
    result = await renderPage(url);
    onCareersPage = true;
    rendered = renderJobs;
  } else {
    try {
      result = await scrapeFirstSuccess(url, CAREERS_PATHS, (u) => scrapePage(u, probeOpts));
      onCareersPage = true;
    } catch {
      // No same-host careers page — scrape the homepage anyway so we can still
      // discover an off-site careers link (footer "Nous rejoindre" → external site).
      result = await scrapePage(url, probeOpts);
      onCareersPage = false;
    }
  }

  // Most competitors host their openings on an ATS (Greenhouse, Lever, Ashby, …)
  // linked/embedded from the careers page — scraping the page alone misses them.
  // The board link lives in the SSR HTML, so the cheap L0 probe already surfaces it
  // (no render needed to reach the structured API).
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
    // instead of the marketing careers page. Board pages are JS-heavy → render.
    // Fail-soft: keep the careers page.
    try {
      const hop = await renderPage(board.boardUrl);
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
  // linked from the nav/footer ("Nous rejoindre", "Jobs" → a separate jobs site,
  // e.g. Welcome to the Jungle or a Notion board). Follow that link one cross-host
  // hop (rendered — these targets are almost always SPAs); the downstream LLM
  // extracts the listing. Same-host links are already covered by the path
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
        const hop = await renderPage(careersLink);
        if (hop.text.length > MIN_CAREERS_HOP_TEXT) {
          return { ...hop, metadata: { ...hop.metadata, careersFollowed: careersLink } };
        }
      }
    } catch {
      // ignore — fall through to the original page
    }
  }

  // Same-host careers page, no ATS, no off-site link: it may still render its
  // openings client-side (a "Loading positions…" placeholder). The probe fetched
  // it cheaply at L0, so render it once now to surface the roles. Fail-soft and
  // only kept when the render yields more text than the L0 capture.
  if (renderJobs && onCareersPage && !rendered) {
    try {
      const full = await renderPage(finalUrl);
      if (full.text.length > result.text.length) {
        return { ...full, metadata: { ...full.metadata, jobsRendered: true } };
      }
    } catch {
      // ignore — keep the L0 careers page below
    }
  }
  return result;
}
