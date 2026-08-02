import { afterAll, describe, expect, it, mock } from "bun:test";
import type { ScrapeOutcome } from "../../types";

// Capture the real module BEFORE mocking it. jobs/ loads before lib/ in the shared
// bun-test process, so this namespace holds the real implementation here. Bun's
// mock.module() mutates the exports on this SAME namespace object, so we grab the
// real scrapeFirstSuccess as a plain function value now (a plain const is not
// rewritten by the later mock.module) to delegate to it without infinite recursion.
const realCrawler = await import("../../lib/crawler");
const realScrapeFirstSuccess = realCrawler.scrapeFirstSuccess;

// scrape() drives the real careers-link discovery + ATS detection but reaches the
// network through ../lib/crawler. Mock that module so the whole flow runs offline:
// scrapeFirstSuccess throws (every standard careers path 404s, like thenile.dev),
// and scrapePage serves per-URL fixtures.
const HOMEPAGE = "https://acme.com";

const homepageHtml = `<html><body>
  <h1>Acme — serverless Postgres</h1>
  <nav><a href="/product">Product</a><a href="/pricing">Pricing</a></nav>
  <footer><a href="/about-us#careers">Careers</a></footer>
</body></html>`;

// A real careers listing: short next to a marketing homepage, but well over the
// MIN_CAREERS_HOP_TEXT (200) floor.
const listingHtml = `<html><body>
  <h2>Open positions</h2>
  <p>We are hiring across engineering to build the future of serverless Postgres.</p>
  <ul>
    <li>Founding Engineer - Database Internals — Anywhere / Remote / Full time</li>
    <li>Founding Engineer - Cloud Infrastructure — Anywhere / Remote / Full time</li>
    <li>Founding Engineer - Auth — Anywhere / Remote / Full time</li>
  </ul>
  <p>Apply now and help us shape the future of the database.</p>
</body></html>`;

function outcome(html: string, url: string): ScrapeOutcome {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url, scrapedWith: "mock" },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}

// A careers HUB: reads like a careers page (so path discovery commits to it) but
// carries no roles — those sit one level deeper behind "Browse jobs".
// atlassian.com/company/careers is exactly this.
const hubHtml = `<html><body>
  <h1>Careers at Acme</h1>
  <p>Life at Acme: join our team of builders. Meet the people behind the product.</p>
  <nav>
    <a href="/careers">Careers</a>
    <a href="/careers/all-jobs">Browse jobs</a>
    <a href="/careers/teams">Our teams</a>
    <a href="/careers/benefits">Benefits and perks</a>
  </nav>
</body></html>`;

// A real listing that ALSO carries careers-marketing links in its chrome. Nothing
// here advertises another listing, so the scraper must stay put.
const listingWithNavHtml = listingHtml.replace(
  "</body>",
  `<nav>
    <a href="/careers/teams">Our teams</a>
    <a href="/careers/benefits">Benefits and perks</a>
  </nav></body>`,
);

// A careers hub that links BOTH an enterprise ATS board (Workday, thousands of
// global postings) and the site's own localised job search. accenture.com/at-de is
// exactly this.
const hubWithBoardHtml = hubHtml.replace(
  "</nav>",
  `<a href="https://acme.wd3.myworkdayjobs.com/acmecareers/userHome">Open your application</a>
   </nav>`,
);

// A Workable board on a VANITY domain: an empty SPA shell whose only tell is the
// `apply.workable.com/<token>` alternate in its head. careers.exotec.com is this.
const vanityBoardShellHtml = `<html><head>
  <title>Acme - Current Openings</title>
  <link rel="alternate" hreflang="en" href="https://apply.workable.com/acme/?lng=en">
  </head><body><div id="app"></div></body></html>`;

// A careers page whose only route to the roles is a button to that vanity board.
const careersToVanityHtml = `<html><body>
  <h1>Careers at Acme</h1>
  <p>Life at Acme: join our team of builders.</p>
  <a href="https://careers.acme.com/">See job openings</a>
</body></html>`;

const scrapePage = mock(async (u: string): Promise<ScrapeOutcome> => {
  if (u.includes("/jobs-with-links")) return outcome(listingWithNavHtml, u);
  if (u.includes("/careers/all-jobs")) return outcome(listingHtml, u);
  if (u.includes("/careers")) return outcome(hubHtml, u);
  if (u.includes("/about-us")) return outcome(listingHtml, u);
  if (u.includes("jobs.wttj.com")) return outcome(listingHtml, u);
  return outcome(homepageHtml, HOMEPAGE);
});
// Bun cannot un-register a mock.module mid-run, so instead of restoring the real
// module in afterAll, keep it mocked for the whole process but make this mock a
// transparent passthrough to the real scrapeFirstSuccess once this file's tests are
// done — flipped by the flag below. This un-poisons any later file (e.g.
// src/lib/__tests__/scrape-first-success.test.ts) that imports the mocked binding.
let jobsCareersMockActive = true;
const scrapeFirstSuccess = mock(
  async (...args: Parameters<typeof realScrapeFirstSuccess>): Promise<ScrapeOutcome> => {
    if (jobsCareersMockActive) throw new Error("no standard careers path (all 404)");
    return realScrapeFirstSuccess(...args);
  },
);

mock.module("../../lib/crawler", () => ({ ...realCrawler, scrapePage, scrapeFirstSuccess }));

const { scrape } = await import("../jobs.scraper");

afterAll(() => {
  jobsCareersMockActive = false;
});

describe("jobs scraper — careers discovery routing", () => {
  it("follows a discovered SAME-host careers page when the standard paths 404", async () => {
    // Regression: thenile.dev lists openings at /about-us#careers (a non-standard
    // path, linked only from the footer). findCareersLink surfaced it, but scrape()
    // used to follow off-site links only, so the page was discovered then dropped.
    const res = await scrape("comp-1", HOMEPAGE);
    expect(res.metadata.careersFollowed).toBe("https://acme.com/about-us#careers");
    expect(res.text).toContain("Open positions");
    expect(res.text).toContain("Founding Engineer - Auth");
  });

  it("still follows an off-site careers link (cross-host, unchanged)", async () => {
    const html = `<html><body><footer>
      <a href="https://jobs.wttj.com/acme">We're hiring</a>
    </footer></body></html>`;
    scrapePage.mockImplementationOnce(async () => outcome(html, HOMEPAGE));
    const res = await scrape("comp-2", HOMEPAGE);
    expect(res.metadata.careersFollowed).toBe("https://jobs.wttj.com/acme");
    expect(res.text).toContain("Founding Engineer - Auth");
  });

  it("leaves a careers HUB for the listing it links one level deeper", async () => {
    // Regression (atlassian.com): /careers is a culture page that reads like a
    // careers page, so path discovery committed to it and stopped — the roles live
    // at /careers/all-jobs, linked as "Browse jobs". Result was a snapshot of
    // marketing copy with zero openings, every run.
    const res = await scrape("comp-4", "https://acme.com/careers");
    expect(res.metadata.careersFollowed).toBe("https://acme.com/careers/all-jobs");
    expect(res.text).toContain("Founding Engineer - Auth");
  });

  it("stays on a careers page that has roles when no LISTING link is offered", async () => {
    // The other side of the hub hop: "Our teams" / "Benefits and perks" are careers
    // links, but none advertises a listing, so following one would trade a page of
    // roles for a page of marketing.
    const res = await scrape("comp-5", "https://acme.com/jobs-with-links");
    expect(res.metadata.careersFollowed).toBeUndefined();
    expect(res.text).toContain("Founding Engineer - Auth");
  });

  it("leaves an UNREADABLE ATS board for the listing the page links itself", async () => {
    // Regression (accenture.com/at-de/careers): a detected board used to short-circuit
    // the whole link-follow path, so when its API turned out to be unusable — here an
    // enterprise Workday board declaring more roles than the page cap can cover — the
    // scraper fell back to the marketing hub and threw away the site's own job search
    // sitting one click away. It must not hop into the oversized board either: any
    // entry point on it is an arbitrary 20-row slice of a global, multi-country list.
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      fetched.push(String(u));
      return new Response(
        JSON.stringify({ total: 2000, jobPostings: [{ title: "Engineer", externalPath: "/j/1" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    scrapePage.mockImplementationOnce(async (u: string) => outcome(hubWithBoardHtml, u));
    try {
      const res = await scrape("comp-6", "https://acme.com/careers");
      expect(res.metadata.careersFollowed).toBe("https://acme.com/careers/all-jobs");
      expect(res.text).toContain("Founding Engineer - Auth");
      expect(scrapePage.mock.calls.some(([u]) => String(u).includes("myworkdayjobs"))).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("re-detects the ATS on the page it hops to (board on a vanity domain)", async () => {
    // Regression (exotec.com/careers → careers.exotec.com): the board lives on the
    // company's own subdomain, so the careers page carries no ATS tell at all and
    // detection — which only ever ran on the FIRST page — found nothing. The hop
    // landed on an empty SPA shell and the run ended with marketing copy. The shell's
    // head still names the board, so detecting again after the hop pulls the postings
    // from the API, without a browser render.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jobs: [
            {
              title: "Robotics Engineer",
              department: "Engineering",
              url: "https://apply.workable.com/j/ABC",
              published_on: "2026-07-27",
              locations: [{ city: "Lille", country: "France" }],
            },
            { title: "Account Executive", function: "Sales", telecommuting: true },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    scrapePage.mockImplementation(async (u: string) => {
      if (u.includes("careers.acme.com")) return outcome(vanityBoardShellHtml, u);
      return outcome(careersToVanityHtml, u);
    });
    try {
      const res = await scrape("comp-7", "https://acme.com/careers");
      expect(res.metadata.careersFollowed).toBe("https://careers.acme.com/");
      expect(res.metadata.atsDetected).toBe("workable");
      expect(res.metadata.atsJobs).toBe(2);
      expect(res.text).toContain("Robotics Engineer");
      expect(res.text).toContain("Lille, France");
    } finally {
      globalThis.fetch = realFetch;
      scrapePage.mockImplementation(async (u: string) => {
        if (u.includes("/jobs-with-links")) return outcome(listingWithNavHtml, u);
        if (u.includes("/careers/all-jobs")) return outcome(listingHtml, u);
        if (u.includes("/careers")) return outcome(hubHtml, u);
        if (u.includes("/about-us")) return outcome(listingHtml, u);
        if (u.includes("jobs.wttj.com")) return outcome(listingHtml, u);
        return outcome(homepageHtml, HOMEPAGE);
      });
    }
  });

  it("does NOT wander off an already-found careers page to another same-host link", async () => {
    // The monitor URL is itself a careers URL (direct render). Even if that page
    // links another same-host "Careers" entry, we keep the page that has the jobs.
    const careersUrl = "https://acme.com/about-us#careers";
    const res = await scrape("comp-3", careersUrl);
    expect(res.metadata.careersFollowed).toBeUndefined();
    expect(res.text).toContain("Founding Engineer - Auth");
  });

  it("detects an EMBEDDED board on the rendered careers page", async () => {
    // Regression (clickup.com): the board is not LINKED, it is EMBEDDED. The SSR
    // HTML ships an empty `<div id="ashby_embed">` and nothing anywhere spells out
    // `jobs.ashbyhq.com/acme` — the script tag that does is appended after
    // hydration. Detection only ever ran on the L0 probe, so the board was
    // invisible and the AI floor extracted the two roles the marketing page
    // hard-codes as if they were the whole board (2 stored against 64 open).
    //
    // Two things had to change for this to resolve, and both are exercised here:
    // "Explore the role" must not be mistaken for the listing link (or the run
    // hops into one job's page and never renders), and the render must be
    // re-detected on — its iframe adds no TEXT, so the old "did the render add
    // anything?" gate discarded the one capture that names the board.
    const ssrHtml = `<html><body>
      <h1>Careers at Acme</h1>
      <p>Life at Acme: join our team of builders and help us shape the product.</p>
      <article><h3>100x Operator, Chief Of Staff</h3>
        <a href="/careers/100x-cos">Explore the role</a></article>
      <article><h3>100x Marketer, Chief Marketing Officer</h3>
        <a href="/careers/100x-cmo">Explore the role</a></article>
      <h2>Open positions</h2><div id="ashby_embed"></div>
    </body></html>`;
    // What the DOM looks like once the embed script has run. The board itself
    // renders in a cross-origin iframe, so the page gains no text at all.
    const renderedHtml = ssrHtml.replace(
      "</body>",
      `<script src="https://jobs.ashbyhq.com/acme/embed?version=2"></script></body>`,
    );
    const careersUrl = "https://acme.com/careers";
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      fetched.push(String(u));
      return new Response(
        JSON.stringify({
          jobs: [
            {
              title: "Staff Backend Engineer, Hierarchy",
              department: "Engineering",
              location: "United States",
              jobUrl: "https://jobs.ashbyhq.com/acme/1",
            },
            {
              title: "Technical Account Manager",
              department: "Customer Experience",
              location: "Philippines",
              jobUrl: "https://jobs.ashbyhq.com/acme/2",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    // The discovery probe is L0 (SSR); the later render goes through scrapePage.
    scrapeFirstSuccess.mockImplementationOnce(async () => outcome(ssrHtml, careersUrl));
    scrapePage.mockImplementation(async (u: string) => outcome(renderedHtml, u));
    try {
      const res = await scrape("comp-embed", HOMEPAGE);
      expect(res.metadata.careersFollowed).toBeUndefined();
      expect(res.metadata.atsDetected).toBe("ashby");
      expect(res.metadata.atsJobs).toBe(2);
      expect(res.text).toContain("Staff Backend Engineer, Hierarchy");
      expect(fetched.some((u) => u.includes("posting-api/job-board/acme"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      scrapePage.mockImplementation(async (u: string) => {
        if (u.includes("/jobs-with-links")) return outcome(listingWithNavHtml, u);
        if (u.includes("/careers/all-jobs")) return outcome(listingHtml, u);
        if (u.includes("/careers")) return outcome(hubHtml, u);
        if (u.includes("/about-us")) return outcome(listingHtml, u);
        if (u.includes("jobs.wttj.com")) return outcome(listingHtml, u);
        return outcome(homepageHtml, HOMEPAGE);
      });
    }
  });

  it("renders for an embed container even off the homepage fallback", async () => {
    // The other vendor of the same class (later.com is `grnhse_app`), on the path
    // that used to render NOTHING: every standard careers path 404s, so we hold the
    // homepage — which here embeds the board inline, the one-page-site shape. The
    // container is the page telling us it is holding a board back, and it is the
    // only reason to spend a render on a page that isn't a careers page.
    const ssrHtml = `<html><body>
      <h1>Acme</h1><p>Serverless Postgres, built for developers who ship.</p>
      <h2>Open positions</h2><div id="grnhse_app"></div>
    </body></html>`;
    const renderedHtml = ssrHtml.replace(
      "</body>",
      `<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></body>`,
    );
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jobs: [
            {
              title: "Founding Engineer",
              departments: [{ name: "Engineering" }],
              location: { name: "Remote" },
              absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    // First call is the L0 homepage probe; the render that follows returns the DOM.
    scrapePage.mockImplementationOnce(async () => outcome(ssrHtml, HOMEPAGE));
    scrapePage.mockImplementation(async (u: string) => outcome(renderedHtml, u));
    try {
      const res = await scrape("comp-embed-home", HOMEPAGE);
      expect(res.metadata.atsDetected).toBe("greenhouse");
      expect(res.metadata.atsJobs).toBe(1);
      expect(res.text).toContain("Founding Engineer");
    } finally {
      globalThis.fetch = realFetch;
      scrapePage.mockImplementation(async (u: string) => {
        if (u.includes("/jobs-with-links")) return outcome(listingWithNavHtml, u);
        if (u.includes("/careers/all-jobs")) return outcome(listingHtml, u);
        if (u.includes("/careers")) return outcome(hubHtml, u);
        if (u.includes("/about-us")) return outcome(listingHtml, u);
        if (u.includes("jobs.wttj.com")) return outcome(listingHtml, u);
        return outcome(homepageHtml, HOMEPAGE);
      });
    }
  });
});

// ── Generic JSON-LD rung (Hiring Intelligence v2 P4) ─────────────────────────

const TT_LISTING_URL = "https://jobs.acme.com/jobs";

/** A hosted career site: names no ATS, links its postings, carries no markup itself. */
function teamtailorListing(count: number): string {
  const rows = Array.from(
    { length: count },
    (_i, n) => `<li><a href="/jobs/${1000 + n}-role-${n}">Role ${n} · Engineering · Berlin</a></li>`,
  ).join("");
  return `<html><head>
    <script src="https://teamtailor-cdn.com/assets/packs/js/career-site.js"></script>
    </head><body><h1>Open positions</h1><ul>${rows}</ul>
    <a href="/departments/engineering">Engineering</a></body></html>`;
}

/** A job page the way Teamtailor ships one: a JobPosting block, no `url` field. */
function jobPage(title: string, country = "DE"): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "http://schema.org/",
    "@type": "JobPosting",
    title,
    description: "&lt;p&gt;We are hiring an engineer.&lt;/p&gt;",
    datePosted: "2026-07-01T09:00:00+02:00",
    employmentType: "FULL_TIME",
    jobLocation: [{ "@type": "Place", address: { addressLocality: "Berlin", addressCountry: country } }],
  })}</script></head><body><h1>${title}</h1></body></html>`;
}

const detailCalls = (): string[] =>
  scrapePage.mock.calls.map(([u]) => String(u)).filter((u) => /\/jobs\/\d+/.test(u));

describe("jobs scraper — generic JSON-LD rung", () => {
  it("resolves a hosted career site by reading its job pages", async () => {
    scrapePage.mockImplementation(async (u: string) => {
      if (/\/jobs\/(\d+)/.test(u)) {
        return outcome(jobPage(`Role ${/\/jobs\/(\d+)/.exec(u)?.[1]}`), u);
      }
      return outcome(teamtailorListing(3), u);
    });
    scrapePage.mockClear();
    const res = await scrape("comp-tt", TT_LISTING_URL);
    expect(res.metadata.atsJobs).toBe(3);
    // Named for the coverage counter off its asset host: a Teamtailor career site on
    // a vanity domain states its slug nowhere else.
    expect(res.metadata.atsDetected).toBe("teamtailor");
    expect(res.text).toContain("Role 1000");
    // The country the markup states, carried into the location the geo resolver reads.
    expect(res.text).toContain("Berlin, DE");
    expect(detailCalls()).toHaveLength(3);
  });

  it("opens at most 30 unseen job pages in one run, and keeps the rest for the next", async () => {
    scrapePage.mockImplementation(async (u: string) => {
      if (/\/jobs\/(\d+)/.test(u)) {
        return outcome(jobPage(`Role ${/\/jobs\/(\d+)/.exec(u)?.[1]}`), u);
      }
      return outcome(teamtailorListing(40), u);
    });
    scrapePage.mockClear();
    const res = await scrape("comp-tt-cap", TT_LISTING_URL);
    expect(detailCalls()).toHaveLength(30);
    expect(res.metadata.atsJobs).toBe(30);
  });

  it("carries a posting we already hold forward instead of re-opening its page", async () => {
    // Title and department come back exactly as stored: the jobs delta keys on that
    // pair, so re-deriving them from a listing card would close the role and open a
    // near-identical one every week.
    scrapePage.mockImplementation(async (u: string) => {
      if (/\/jobs\/(\d+)/.test(u)) {
        return outcome(jobPage(`Role ${/\/jobs\/(\d+)/.exec(u)?.[1]}`), u);
      }
      return outcome(teamtailorListing(3), u);
    });
    scrapePage.mockClear();
    const res = await scrape("comp-tt-known", TT_LISTING_URL, {
      knownJobs: [
        {
          // Stated with tracking noise on purpose: identity is the canonical URL.
          url: "https://jobs.acme.com/jobs/1000-role-0?utm_source=weekly",
          title: "Stored Title",
          department: "Stored Dept",
        },
      ],
    });
    expect(res.metadata.atsJobs).toBe(3);
    expect(detailCalls()).toHaveLength(2);
    expect(res.text).toContain("Stored Title");
    expect(res.text).toContain("Stored Dept");
  });

  it("hands back NOTHING when the listing paginates past the walk cap", async () => {
    // A prefix of a board is read downstream as the whole board, so every posting
    // past the cap would be diffed as closed. Falling to the AI floor reports fewer
    // roles; it never invents a wave of closures.
    scrapePage.mockImplementation(async (u: string) => {
      if (/\/jobs\/(\d+)/.test(u)) return outcome(jobPage("Role"), u);
      const page = Number(/[?&]page=(\d+)/.exec(u)?.[1] ?? 1);
      return outcome(
        teamtailorListing(3).replace("</body>", `<a href="/jobs?page=${page + 1}">Next</a></body>`),
        u,
      );
    });
    scrapePage.mockClear();
    const res = await scrape("comp-tt-paged", TT_LISTING_URL);
    expect(res.metadata.atsJobs).toBeUndefined();
    expect(detailCalls()).toHaveLength(0);
  });

  it("never lets an API-resolved board reach the generic rung", async () => {
    // The ladder is exclusive. A Greenhouse board answers from its API, so no job
    // page is ever opened and the board is never ingested twice.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jobs: [
            {
              title: "Backend Engineer",
              departments: [{ name: "Engineering" }],
              absolute_url: "https://boards.greenhouse.io/acme/jobs/4001",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    scrapePage.mockImplementation(async (u: string) =>
      outcome(
        `<html><body><h1>Open positions</h1>
         <a href="https://boards.greenhouse.io/acme">See our openings</a></body></html>`,
        u,
      ),
    );
    scrapePage.mockClear();
    try {
      const res = await scrape("comp-gh", "https://acme.com/careers");
      expect(res.metadata.atsDetected).toBe("greenhouse");
      expect(res.metadata.atsJobs).toBe(1);
      expect(detailCalls()).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
