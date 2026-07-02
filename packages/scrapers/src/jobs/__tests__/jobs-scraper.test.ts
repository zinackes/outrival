import { describe, expect, it, mock } from "bun:test";
import type { ScrapeOutcome } from "../../types";

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

const scrapePage = mock(async (u: string): Promise<ScrapeOutcome> => {
  if (u.includes("/about-us")) return outcome(listingHtml, u);
  if (u.includes("jobs.wttj.com")) return outcome(listingHtml, u);
  return outcome(homepageHtml, HOMEPAGE);
});
const scrapeFirstSuccess = mock(async (): Promise<ScrapeOutcome> => {
  throw new Error("no standard careers path (all 404)");
});

mock.module("../../lib/crawler", () => ({ scrapePage, scrapeFirstSuccess }));

const { scrape } = await import("../jobs.scraper");

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

  it("does NOT wander off an already-found careers page to another same-host link", async () => {
    // The monitor URL is itself a careers URL (direct render). Even if that page
    // links another same-host "Careers" entry, we keep the page that has the jobs.
    const careersUrl = "https://acme.com/about-us#careers";
    const res = await scrape("comp-3", careersUrl);
    expect(res.metadata.careersFollowed).toBeUndefined();
    expect(res.text).toContain("Founding Engineer - Auth");
  });
});
