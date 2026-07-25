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

  it("does NOT wander off an already-found careers page to another same-host link", async () => {
    // The monitor URL is itself a careers URL (direct render). Even if that page
    // links another same-host "Careers" entry, we keep the page that has the jobs.
    const careersUrl = "https://acme.com/about-us#careers";
    const res = await scrape("comp-3", careersUrl);
    expect(res.metadata.careersFollowed).toBeUndefined();
    expect(res.text).toContain("Founding Engineer - Auth");
  });
});
