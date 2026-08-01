import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  canonicalJobUrl,
  cardLocationHint,
  jobDetailLinks,
  jobPostingsFromJsonLd,
  listingCardText,
  nextListingLinks,
} from "./jsonld";

// Real captures, not hand-written approximations of them: a Teamtailor job page
// (jobs.lunar.app, captured 2026-08-01) and a Teamtailor listing (jobs.tibber.com,
// same day). Both trimmed to the markup under test, both verbatim in it.
const FIXTURES = join(import.meta.dir, "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), "utf8");

const JOB_URL = "https://jobs.lunar.app/jobs/7986365-sanctions-lead";
const LISTING_URL = "https://jobs.tibber.com/jobs";

function ldPage(json: string): string {
  return `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;
}

describe("jobPostingsFromJsonLd — real Teamtailor job page", () => {
  it("reads the posting the page states", () => {
    const [job] = jobPostingsFromJsonLd(fixture("teamtailor-job"), JOB_URL);
    expect(job).toBeDefined();
    expect(job?.title).toBe("Sanctions Lead");
    expect(job?.employmentType).toBe("FULL_TIME");
    expect(job?.postedAt?.slice(0, 10)).toBe("2026-06-29");
  });

  it("prefers the ISO country the address states, so geo never has to guess", () => {
    const [job] = jobPostingsFromJsonLd(fixture("teamtailor-job"), JOB_URL);
    // "København, DK" — locality plus the alpha-2 code, which is what makes the
    // offline resolver's intersection exact instead of a city-name coin flip.
    expect(job?.location).toContain("DK");
    expect(job?.location).toContain("København");
  });

  it("takes the page's own URL when the markup states none", () => {
    // Teamtailor emits no `url` on its JobPosting: the posting IS the page. Without
    // this fallback every posting would be unidentifiable and re-inserted forever.
    const [job] = jobPostingsFromJsonLd(fixture("teamtailor-job"), JOB_URL);
    expect(job?.url).toBe(JOB_URL);
  });

  it("un-escapes a body that was HTML-escaped INTO the JSON string", () => {
    // The real payload carries `&lt;p&gt;Banking hasn't changed…`. Stripping tags
    // before decoding entities (the correct order for real HTML) would leave the
    // tags standing in the stored JD.
    const [job] = jobPostingsFromJsonLd(fixture("teamtailor-job"), JOB_URL);
    expect(job?.description).toBeTruthy();
    expect(job?.description).not.toContain("<p>");
    expect(job?.description).not.toContain("&lt;");
    expect(job?.description).toContain("Banking hasn't changed much in decades");
  });
});

describe("jobPostingsFromJsonLd — shapes", () => {
  it("finds a posting nested in @graph", () => {
    const jobs = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "Acme" },
            { "@type": "JobPosting", title: "Staff Engineer" },
          ],
        }),
      ),
      "https://acme.com/jobs/staff-engineer",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("Staff Engineer");
  });

  it("expands an ItemList of ListItem-wrapped postings", () => {
    const jobs = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "ItemList",
          itemListElement: [
            { "@type": "ListItem", item: { "@type": "JobPosting", title: "Backend Engineer" } },
            { "@type": "ListItem", item: { "@type": "JobPosting", title: "Designer" } },
          ],
        }),
      ),
      "https://acme.com/jobs",
    );
    expect(jobs.map((j) => j.title)).toEqual(["Backend Engineer", "Designer"]);
  });

  it("reads baseSalary with a MONTH interval as monthly, not annual", () => {
    // The whole point of P3's period column: 4 500 a month and 4 500 a year are the
    // same two digits and a completely different competitor.
    const [job] = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Support Specialist",
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "eur",
            value: {
              "@type": "QuantitativeValue",
              minValue: 3800,
              maxValue: 4500,
              unitText: "MONTH",
            },
          },
        }),
      ),
      "https://acme.com/jobs/support",
    );
    expect(job?.salaryMin).toBe(3800);
    expect(job?.salaryMax).toBe(4500);
    expect(job?.salaryCurrency).toBe("EUR");
    expect(job?.salaryPeriod).toBe("monthly");
  });

  it("drops a posting whose validThrough has passed", () => {
    const jobs = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Closed Role",
          validThrough: "2020-01-01T00:00:00Z",
        }),
      ),
      "https://acme.com/jobs/closed",
    );
    expect(jobs).toHaveLength(0);
  });

  it("keeps a posting whose validThrough is still ahead", () => {
    const jobs = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Open Role",
          validThrough: "2099-01-01T00:00:00Z",
        }),
      ),
      "https://acme.com/jobs/open",
    );
    expect(jobs).toHaveLength(1);
  });

  it("skips a malformed block and still reads the valid one beside it", () => {
    const html =
      `<html><head>` +
      `<script type="application/ld+json">{ this is not json` +
      `</script>` +
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Survivor",
      })}</script>` +
      `</head><body></body></html>`;
    const jobs = jobPostingsFromJsonLd(html, "https://acme.com/jobs/survivor");
    expect(jobs.map((j) => j.title)).toEqual(["Survivor"]);
  });

  it("counts a posting stated twice only once", () => {
    const html =
      ldPage(JSON.stringify({ "@type": "JobPosting", title: "Dup", url: "https://acme.com/jobs/dup" })) +
      ldPage(JSON.stringify({ "@type": "JobPosting", title: "Dup", url: "https://acme.com/jobs/dup?ref=nav" }));
    expect(jobPostingsFromJsonLd(html, "https://acme.com/jobs")).toHaveLength(1);
  });

  it("keeps a remote posting's country instead of collapsing it to 'Remote'", () => {
    const [job] = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Remote Engineer",
          jobLocationType: "TELECOMMUTE",
          jobLocation: { "@type": "Place", address: { addressCountry: "DE" } },
        }),
      ),
      "https://acme.com/jobs/remote-eng",
    );
    expect(job?.location).toBe("Remote (DE)");
  });

  it("joins several jobLocations with the separator the resolver reads as 'or'", () => {
    const [job] = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Two Cities",
          jobLocation: [
            { address: { addressLocality: "Paris", addressCountry: "FR" } },
            { address: { addressLocality: "Berlin", addressCountry: "DE" } },
          ],
        }),
      ),
      "https://acme.com/jobs/two",
    );
    expect(job?.location).toBe("Paris, FR / Berlin, DE");
  });

  it("says a city once when the board repeats it as the region", () => {
    // Measured on live Teamtailor boards: every German posting states
    // addressLocality "Berlin" AND addressRegion "Berlin".
    const [job] = jobPostingsFromJsonLd(
      ldPage(
        JSON.stringify({
          "@type": "JobPosting",
          title: "Engineer",
          jobLocation: {
            address: { addressLocality: "Berlin", addressRegion: "Berlin", addressCountry: "DE" },
          },
        }),
      ),
      "https://acme.com/jobs/eng",
    );
    expect(job?.location).toBe("Berlin, DE");
  });

  it("leaves an absent field null rather than filling it in", () => {
    const [job] = jobPostingsFromJsonLd(
      ldPage(JSON.stringify({ "@type": "JobPosting", title: "Bare" })),
      "https://acme.com/jobs/bare",
    );
    expect(job?.location).toBeNull();
    expect(job?.description).toBeNull();
    expect(job?.salaryMin).toBeNull();
    expect(job?.salaryPeriod).toBeNull();
    expect(job?.postedAt).toBeNull();
    // No occupationalCategory: the raw department stays the neutral default and the
    // bucket is derived from the title downstream, never invented here.
    expect(job?.department).toBe("Other");
  });

  it("returns nothing for a page with no JobPosting markup", () => {
    expect(jobPostingsFromJsonLd("<html><body><h1>Careers</h1></body></html>", "https://acme.com")).toEqual([]);
  });
});

describe("canonicalJobUrl", () => {
  it("strips query, fragment and trailing slash so a posting keeps one identity", () => {
    expect(canonicalJobUrl("https://Acme.com/jobs/42-eng/?utm_source=x#apply")).toBe(
      "https://acme.com/jobs/42-eng",
    );
  });

  it("resolves a relative href against the page it was found on", () => {
    expect(canonicalJobUrl("/jobs/42-eng", "https://acme.com/careers")).toBe(
      "https://acme.com/jobs/42-eng",
    );
  });

  it("refuses a non-http scheme", () => {
    expect(canonicalJobUrl("mailto:jobs@acme.com")).toBeNull();
  });
});

describe("jobDetailLinks — real Teamtailor listing", () => {
  const html = fixture("teamtailor-listing");

  it("finds every posting the listing links", () => {
    const links = jobDetailLinks(html, LISTING_URL);
    expect(links).toHaveLength(11);
    expect(links).toContain("https://jobs.tibber.com/jobs/7581296-ai-solutions-lead");
  });

  it("ignores the listing itself, its facets and its feed", () => {
    const links = jobDetailLinks(html, LISTING_URL);
    expect(links.some((l) => l.endsWith("/jobs"))).toBe(false);
    expect(links.some((l) => l.includes("/departments/"))).toBe(false);
    expect(links.some((l) => l.includes(".rss"))).toBe(false);
  });
});

describe("jobDetailLinks — shapes", () => {
  it("never leaves the host: another company's board is not this competitor's", () => {
    const html = `<html><body>
      <a href="/jobs/1-engineer">Engineer</a>
      <a href="https://boards.greenhouse.io/other/jobs/99">Partner role</a>
      <a href="https://www.linkedin.com/jobs/view/123">On LinkedIn</a>
    </body></html>`;
    expect(jobDetailLinks(html, "https://acme.com/careers")).toEqual([
      "https://acme.com/jobs/1-engineer",
    ]);
  });

  it("rejects a job segment with nothing behind it, and its utility paths", () => {
    const html = `<html><body>
      <a href="/jobs">All jobs</a>
      <a href="/jobs/search?q=eng">Search</a>
      <a href="/jobs/index.html">Index</a>
      <a href="/careers/departments">Departments</a>
    </body></html>`;
    expect(jobDetailLinks(html, "https://acme.com/careers")).toEqual([]);
  });

  it("reads postings listed as an ItemList of urls with no anchor", () => {
    const html = ldPage(
      JSON.stringify({
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", url: "https://acme.com/jobs/1-eng" },
          { "@type": "ListItem", url: "https://acme.com/jobs/2-design" },
        ],
      }),
    );
    expect(jobDetailLinks(html, "https://acme.com/careers")).toEqual([
      "https://acme.com/jobs/1-eng",
      "https://acme.com/jobs/2-design",
    ]);
  });

  it("deduplicates the same posting linked twice with different tracking", () => {
    const html = `<html><body>
      <a href="/jobs/1-engineer?src=card">Engineer</a>
      <a href="/jobs/1-engineer">Engineer</a>
    </body></html>`;
    expect(jobDetailLinks(html, "https://acme.com/careers")).toHaveLength(1);
  });
});

describe("nextListingLinks", () => {
  it("follows only pagination the page itself renders", () => {
    const html = `<html><body>
      <a href="/careers?page=2">2</a>
      <a href="/careers?page=3">3</a>
      <a href="/about">About</a>
      <a href="/blog?page=2">Blog page 2</a>
    </body></html>`;
    expect(nextListingLinks(html, "https://acme.com/careers")).toEqual([
      "https://acme.com/careers?page=2",
      "https://acme.com/careers?page=3",
    ]);
  });

  it("takes a rel=next on the same listing", () => {
    const html = `<html><body><a rel="next" href="/careers?p=2">Next</a></body></html>`;
    expect(nextListingLinks(html, "https://acme.com/careers")).toEqual([
      "https://acme.com/careers?p=2",
    ]);
  });

  it("finds nothing on an unpaginated listing", () => {
    expect(nextListingLinks(fixture("teamtailor-listing"), LISTING_URL)).toEqual([]);
  });
});

describe("listing card enrichment", () => {
  it("keeps each job link's own card text", () => {
    const cards = listingCardText(fixture("teamtailor-listing"), LISTING_URL);
    expect(cards.get("https://jobs.tibber.com/jobs/7581296-ai-solutions-lead")).toContain(
      "Ai Solutions Lead",
    );
  });

  it("returns what is left of a card once its title is removed", () => {
    expect(cardLocationHint("Senior Engineer · Engineering · Berlin", "Senior Engineer")).toBe(
      "Engineering · Berlin",
    );
  });

  it("refuses a remainder too long to be a location line", () => {
    const card = `Senior Engineer ${"we are a fast growing company ".repeat(5)}`;
    expect(cardLocationHint(card, "Senior Engineer")).toBeNull();
  });

  it("returns null when the card says nothing but the title", () => {
    expect(cardLocationHint("Senior Engineer", "Senior Engineer")).toBeNull();
  });
});
