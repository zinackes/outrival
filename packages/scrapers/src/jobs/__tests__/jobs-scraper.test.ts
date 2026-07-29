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
});
