import { scrapePage, scrapeFirstSuccess } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions, KnownJob } from "../types";
import {
  detectAtsBoard,
  detectAtsPlatform,
  fetchAtsJobs,
  appendAtsJobsToHtml,
  atsBoardFromKey,
  mkJob,
  type AtsBoard,
  type AtsJob,
} from "./ats";
import {
  canonicalJobUrl,
  cardLocationHint,
  jobDetailLinks,
  jobPostingsFromJsonLd,
  listingCardText,
  nextListingLinks,
  MAX_LISTING_PAGES,
  MAX_NEW_JOB_PAGES,
} from "./jsonld";
import { findCareersLink, findJobListingLink, isSameResource } from "./careers-link";
import { hasCareersSignals } from "./signals";

/** Job-detail links that make a page a listing on structure alone. */
const MIN_LISTING_JOB_LINKS = 3;

/**
 * Platform name recorded when a board resolves through schema.org markup on a
 * career site we cannot name. Not a failure — a self-built site is exactly what
 * the generic rung is for — but distinct in the coverage counter from a named
 * platform that has no adapter yet.
 */
const GENERIC_PLATFORM = "generic";

// A page is only trusted as "the careers page" when it actually reads like a jobs
// listing OR links/embeds an ATS board — not merely because the path returned HTTP
// 200. On a client-routed SPA every path 200s with the app shell, so without this a
// non-existent `/careers` would lock in and get LLM-extracted for jobs that aren't
// there. Fail-open on the ATS side: detectAtsBoard reads the same HTML cheaply.
function looksLikeCareers(res: ScrapeOutcome): boolean {
  if (hasCareersSignals(res.html) || detectAtsBoard(res.html) !== null) return true;
  // A page pointing at several job-detail pages of its OWN host is a listing,
  // whatever vocabulary it uses. Teamtailor's hosted sites are the case in point:
  // they name no ATS, and their listing carries no JobPosting markup (that lives on
  // the job pages), so on wording alone a real board could be thrown away right
  // before the rung that can read it.
  const base = typeof res.metadata.url === "string" ? res.metadata.url : null;
  return base !== null && jobDetailLinks(res.html, base).length >= MIN_LISTING_JOB_LINKS;
}

// patch-31 — synthesise a jobs snapshot straight from the ATS API result, no
// browser scrape. Deterministic (appendAtsJobsToHtml sorts) so the content hash is
// stable, and the JSON island feeds extract-jobs exactly like the appended path.
//
// The recorded url is the BOARD, not the monitor's url. This capture's content came
// from the board API, and `snapshots.resolved_url` is defined as where the content
// came from — naming the monitor url made a competitor whose roles are read straight
// off Ashby report "Captured from acme.com" (8 of them on prod, 2026-08-01), and
// left the read side unable to tell that board apart from a homepage fallback.
function atsOnlyOutcome(board: AtsBoard, jobs: AtsJob[]): ScrapeOutcome {
  const base = "<!doctype html><html><head><title>Open roles</title></head><body></body></html>";
  const jobsText = jobs
    .map((j) => [j.title, j.department, j.location].filter(Boolean).join(" — "))
    .join("\n");
  return {
    html: appendAtsJobsToHtml(base, board, jobs),
    text: jobsText,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: board.boardUrl,
      scrapedWith: "ats-api",
      atsDetected: board.provider,
      atsJobs: jobs.length,
    },
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

/** What a page's ATS board (if any) can give us. */
type AtsResolution =
  | { kind: "none" }
  | { kind: "jobs"; board: AtsBoard; jobs: AtsJob[] }
  /** Board found, API unusable (no mapping / down / empty) — its page is worth a hop. */
  | { kind: "board"; board: AtsBoard }
  /** Board found but larger than the page cap — see AtsFetch.truncated. */
  | { kind: "oversized"; board: AtsBoard };

async function resolveAts(html: string): Promise<AtsResolution> {
  const board = detectAtsBoard(html);
  if (!board) return { kind: "none" };
  const { jobs, truncated } = await fetchAtsJobs(board);
  if (jobs && jobs.length > 0) return { kind: "jobs", board, jobs };
  return { kind: truncated ? "oversized" : "board", board };
}

function hostname(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Cross-host is always worth a hop. Same-host only from the homepage fallback (the
 * standard paths 404'd, the site links its openings at a non-standard path) or from
 * a hub whose LISTING link we found. Never re-fetch the page we're standing on.
 */
function shouldFollow(link: string, from: string, onCareersPage: boolean, isListing: boolean) {
  try {
    if (new URL(link).hostname !== new URL(from).hostname) return true;
  } catch {
    return false;
  }
  return (!onCareersPage || isListing) && !isSameResource(link, from);
}

/** Append the ATS postings to a captured page: visible list + JSON island. */
function withAtsJobs(
  page: ScrapeOutcome,
  board: AtsBoard,
  jobs: AtsJob[],
  extra: Record<string, unknown> = {},
): ScrapeOutcome {
  const jobsText = jobs
    .map((j) => [j.title, j.department, j.location].filter(Boolean).join(" — "))
    .join("\n");
  return {
    ...page,
    html: appendAtsJobsToHtml(page.html, board, jobs),
    text: `${page.text}\n${jobsText}`,
    metadata: {
      ...page.metadata,
      ...extra,
      atsDetected: board.provider,
      atsJobs: jobs.length,
    },
  };
}

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
      const { jobs } = await fetchAtsJobs(board);
      if (jobs) return atsOnlyOutcome(board, jobs);
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
  // waitForStableContent: rendering is not enough on its own. A board fetches its
  // rows AFTER hydration, and careers sites are beacon-heavy, so `networkidle`
  // rarely arrives and the bounded settle expires on the empty shell — measured on
  // atlassian.com, which captured the roles in only 1 run out of 3 even once the
  // right page was reached. Holding for the DOM to stop growing closes that gap.
  // expandLists: and reaching a settled listing is STILL not enough. A board that
  // paginates client-side settles on its first page — Workable renders 10 rows and a
  // "Show more", while its own header reads "56 jobs" — so the capture was a slice
  // that read as the whole list, and every role past the fold was extracted as
  // absent. Measured on careers.exotec.com: 10 postings stored against 56 open.
  const renderPage = (u: string) =>
    scrapePage(
      u,
      renderJobs
        ? {
            ...probeOpts,
            render: true,
            progressiveScroll: true,
            waitForStableContent: true,
            expandLists: true,
          }
        : probeOpts,
    );

  /**
   * Follow one hop and keep it only when it carries an actual listing.
   *
   * Cheap first, for a careers/listing link: an L0 fetch is enough to RECOGNISE an
   * ATS board sitting on a vanity domain. `careers.exotec.com` renders an empty SPA
   * shell, yet its <head> names `apply.workable.com/exotec` — the page we came from
   * never did, which is why detection has to run AGAIN here. When it resolves, the
   * postings come from the board API and no browser is used at all. The ATS-board
   * target skips this probe: we already read that board and its API just failed.
   *
   * Otherwise render (boards inject their rows client-side) and keep the page only
   * when it reads like a listing — a mis-followed link lands on an SPA home or a
   * "why work here" blurb. The kept page is NEVER chosen by comparing text length
   * against the page we came from: a marketing hub always has more words than the
   * listing that has the jobs.
   *
   * Fail-soft: any failure returns null and the caller tries the next target.
   */
  const followHop = async (
    target: string,
    via: "atsFollowed" | "careersFollowed",
  ): Promise<ScrapeOutcome | null> => {
    let probe: ScrapeOutcome | null = null;
    // Probe when the render is switched off (the probe IS the capture then), or when
    // the target may be an unrecognised board on a vanity domain.
    if (!renderJobs || via === "careersFollowed") {
      try {
        probe = await scrapePage(target, probeOpts);
        if (via === "careersFollowed") {
          const hopAts = await resolveAts(probe.html);
          if (hopAts.kind === "jobs") {
            return withAtsJobs(probe, hopAts.board, hopAts.jobs, { [via]: target });
          }
        }
      } catch {
        // L0 refused/failed — the render below is still worth a try.
      }
    }
    const keep = (page: ScrapeOutcome) =>
      page.text.length > MIN_CAREERS_HOP_TEXT && looksLikeCareers(page)
        ? { ...page, metadata: { ...page.metadata, [via]: target } }
        : null;
    if (renderJobs) {
      try {
        const full = await renderPage(target);
        // Detect AGAIN on the rendered DOM: an EMBEDDED board names itself only in
        // the markup its own script writes, so this is the first HTML in the hop
        // that can carry it — see the careers-page render below for the full case.
        const renderedAts = await resolveAts(full.html);
        if (renderedAts.kind === "jobs") {
          return withAtsJobs(full, renderedAts.board, renderedAts.jobs, { [via]: target });
        }
        const kept = keep(full);
        if (kept) return kept;
      } catch {
        // ignore — fall back to the L0 probe, then to the caller's next target
      }
    }
    return probe ? keep(probe) : null;
  };

  // Postings we already hold, by canonical URL. A link in this map costs nothing
  // to re-affirm; one that isn't gets its page opened, within the budget below.
  const knownByUrl = new Map<string, KnownJob>();
  for (const job of options.knownJobs ?? []) {
    const key = canonicalJobUrl(job.url);
    if (key) knownByUrl.set(key, job);
  }

  /**
   * The generic rung: resolve a board from schema.org `JobPosting` markup, for the
   * boards no adapter covers. Two shapes, in order:
   *
   *  (a) the page states its postings itself → done, nothing else is fetched;
   *  (b) it links to job pages on its own host → the NEW ones are opened, one at a
   *      time, through the same cascade as everything else (so robots.txt and the
   *      per-domain delay are honoured), capped at MAX_NEW_JOB_PAGES. The rest wait
   *      for the next run; they are new, so nothing downstream mistakes their
   *      absence for a closure.
   *
   * WHAT MAKES A ROLE OPEN, on this rung, is being ON THE LISTING — not having had
   * its page opened. So a listing walk that could not be finished (paginating past
   * the cap, a page that failed) returns null rather than a prefix: the caller
   * treats a non-null result as the authoritative board, and a prefix of a board
   * closes every posting past it.
   *
   * Returns null for "this is not a JSON-LD board" as well, and the caller falls to
   * the AI floor — today's behaviour exactly, which is the floor this rung sits on.
   */
  const resolveJsonLdJobs = async (
    page: ScrapeOutcome,
    pageUrl: string,
  ): Promise<AtsJob[] | null> => {
    const inline = jobPostingsFromJsonLd(page.html, pageUrl);
    if (inline.length > 0) return inline;

    const detailLinks: string[] = [];
    const seenLinks = new Set<string>();
    const visitedPages = new Set<string>();
    const cardText = new Map<string, string>();
    let listingHtml = page.html;
    let listingUrl = pageUrl;
    let truncated = false;

    for (let walked = 1; ; walked++) {
      visitedPages.add(listingUrl);
      for (const link of jobDetailLinks(listingHtml, listingUrl)) {
        if (seenLinks.has(link)) continue;
        seenLinks.add(link);
        detailLinks.push(link);
      }
      for (const [link, text] of listingCardText(listingHtml, listingUrl)) {
        if (!cardText.has(link)) cardText.set(link, text);
      }
      const next = nextListingLinks(listingHtml, listingUrl).find((u) => !visitedPages.has(u));
      if (!next) break;
      if (walked >= MAX_LISTING_PAGES) {
        truncated = true;
        break;
      }
      visitedPages.add(next);
      try {
        const nextPage = await scrapePage(next, probeOpts);
        listingHtml = nextPage.html;
        listingUrl =
          (typeof nextPage.metadata.url === "string" && nextPage.metadata.url) || next;
      } catch {
        // A page of the listing we could not read leaves the board half-known.
        truncated = true;
        break;
      }
    }
    if (truncated || detailLinks.length === 0) return null;

    const jobs: AtsJob[] = [];
    let opened = 0;
    for (const link of detailLinks) {
      const known = knownByUrl.get(link);
      if (known) {
        // Carried forward VERBATIM: the delta keys on title+department, so anything
        // re-derived here would re-key the posting and read as closed-then-reopened.
        jobs.push(mkJob({ title: known.title, department: known.department, url: link }));
        continue;
      }
      if (opened >= MAX_NEW_JOB_PAGES) continue;
      opened++;
      try {
        const detail = await scrapePage(link, probeOpts);
        const [posting] = jobPostingsFromJsonLd(detail.html, link);
        if (!posting) continue;
        // The listing card fills in a location the posting's own markup omits —
        // and ONLY a location, see cardLocationHint.
        const card = posting.location === null ? cardText.get(link) : undefined;
        const hint = card ? cardLocationHint(card, posting.title) : null;
        jobs.push(hint ? { ...posting, location: hint } : posting);
      } catch {
        // One unreadable posting is one posting, never the board.
      }
    }
    return jobs.length > 0 ? jobs : null;
  };

  /**
   * Last rung before the AI floor. Runs ONLY on a page no ATS adapter answered
   * for — the ladder is exclusive, so a Greenhouse board never reaches this, and
   * no board is ever ingested twice.
   */
  const finish = async (page: ScrapeOutcome, board: AtsBoard | null): Promise<ScrapeOutcome> => {
    if (page.metadata.atsJobs != null) return page;
    const pageUrl = (typeof page.metadata.url === "string" && page.metadata.url) || url;
    let jobs: AtsJob[] | null = null;
    try {
      jobs = await resolveJsonLdJobs(page, pageUrl);
    } catch {
      jobs = null;
    }
    if (!jobs) return page;
    // Name the platform for the coverage counter: the board we followed if we
    // detected one (Teamtailor), otherwise whatever the page passively identifies
    // as, otherwise "generic". The resolution itself is derived downstream from
    // whether that name has an API adapter — this rung never has one by definition.
    const platform = board?.provider ?? detectAtsPlatform(page.html) ?? GENERIC_PLATFORM;
    return withAtsJobs(
      page,
      {
        provider: platform,
        token: board?.token ?? hostname(pageUrl) ?? platform,
        boardUrl: pageUrl,
      },
      jobs,
      { jsonLdJobs: jobs.length },
    );
  };

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
      result = await scrapeFirstSuccess(
        url,
        CAREERS_PATHS,
        (u) => scrapePage(u, probeOpts),
        looksLikeCareers,
      );
      onCareersPage = true;
    } catch {
      // No same-host careers page — scrape the homepage anyway so we can still
      // discover an off-site careers link (footer "Nous rejoindre" → external site).
      result = await scrapePage(url, probeOpts);
      onCareersPage = false;
    }
  }

  // Most competitors host their openings on an ATS (Greenhouse, Lever, Ashby, …)
  // linked from the careers page — scraping the page alone misses them. A LINKED
  // board is named in the SSR HTML, so the cheap L0 probe reaches the structured
  // API without a render. An EMBEDDED one is not: see the render below.
  const ats = await resolveAts(result.html);
  if (ats.kind === "jobs") return withAtsJobs(result, ats.board, ats.jobs);

  // The openings live one hop away, behind a button on the page we're standing on.
  // Two kinds of target, tried in order until one yields a real listing:
  //
  //  1. the ATS board itself, when detected but not readable through its API
  //     (no mapping, API down, empty). EXCLUDED when the board is `oversized`: its
  //     page then shows an arbitrary 20-row slice of a global, multi-country board,
  //     which is worse than useless for change detection — accenture.com/at-de is
  //     one tenant of a Workday board with thousands of postings, and its OWN
  //     `/at-de/careers/jobsearch` is the listing that answers the question asked.
  //  2. the strongest careers/listing link on the page. A CROSS-host link (Welcome
  //     to the Jungle, a Notion board, careers.microsoft.com) is always worth it. A
  //     SAME-host link is followed in two cases:
  //       - `result` is the homepage fallback (`!onCareersPage`): the standard path
  //         guesses (/careers, /jobs, …) 404'd, yet the site still links its openings
  //         at a non-standard path (thenile.dev → /about-us#careers, footer only).
  //       - the page we committed to is a careers HUB that links its LISTING one
  //         level deeper ("Browse jobs" → /company/careers/all-jobs). Path discovery
  //         stops at the hub because it reads like a careers page (it is one — it
  //         just has no roles on it). Only a listing-grade link qualifies, so we
  //         never wander sideways into "Life at Acme" (regression-tested).
  //
  // A detected board no longer SHORT-CIRCUITS the link hop: when the board turns out
  // to be unreadable, falling back to the careers hub threw away a perfectly good
  // on-site listing the page was pointing at.
  //
  // Re-fetching the page we already have (same host+path) is skipped.
  const finalUrl = (typeof result.metadata.url === "string" && result.metadata.url) || url;
  const listingLink = onCareersPage ? findJobListingLink(result.html, finalUrl) : null;
  const careersLink = listingLink ?? findCareersLink(result.html, finalUrl);
  // An oversized board's pages are an arbitrary slice wherever you enter them, so a
  // link pointing back at that same host is not an escape either.
  const deadHost = ats.kind === "oversized" ? hostname(ats.board.boardUrl) : null;

  const targets: { url: string; via: "atsFollowed" | "careersFollowed" }[] = [];
  if (ats.kind === "board") targets.push({ url: ats.board.boardUrl, via: "atsFollowed" });
  if (
    careersLink &&
    (deadHost === null || hostname(careersLink) !== deadHost) &&
    shouldFollow(careersLink, finalUrl, onCareersPage, listingLink !== null)
  ) {
    targets.push({ url: careersLink, via: "careersFollowed" });
  }

  const detectedBoard = ats.kind === "none" ? null : ats.board;

  for (const target of targets) {
    const hop = await followHop(target.url, target.via);
    if (hop) return finish(hop, detectedBoard);
  }
  if (ats.kind !== "none") {
    result = { ...result, metadata: { ...result.metadata, atsDetected: ats.board.provider } };
  }

  // Same-host careers page, no ATS, no off-site link: it may still render its
  // openings client-side (a "Loading positions…" placeholder). The probe fetched
  // it cheaply at L0, so render it once now to surface the roles. Fail-soft and
  // only kept when the render yields more text than the L0 capture.
  if (renderJobs && onCareersPage && !rendered) {
    try {
      const full = await renderPage(finalUrl);
      // An EMBEDDED board writes its own reference at runtime: ClickUp's careers
      // page ships `<div id="ashby_embed">` empty and its script tag — the only
      // place `jobs.ashbyhq.com/clickup` is ever spelled out — is appended after
      // hydration. So no amount of L0 probing can name that board, and the AI
      // floor read a 64-role Ashby board as 2 roles. This is the first HTML in
      // the run that carries the token, and the pattern already matches it.
      //
      // Checked BEFORE the text gate: the board renders in a CROSS-ORIGIN iframe,
      // so the parent page gains no text from it, and "did the render add
      // anything?" would throw away the exact capture that reveals the board.
      const renderedAts = await resolveAts(full.html);
      if (renderedAts.kind === "jobs") {
        return withAtsJobs(full, renderedAts.board, renderedAts.jobs, { jobsRendered: true });
      }
      if (full.text.length > result.text.length) {
        return finish({ ...full, metadata: { ...full.metadata, jobsRendered: true } }, detectedBoard);
      }
    } catch {
      // ignore — keep the L0 careers page below
    }
  }
  return finish(result, detectedBoard);
}
