import { describe, expect, it } from "bun:test";
import {
  detectAtsBoard,
  appendAtsJobsToHtml,
  parseAtsJobsFromHtml,
  type AtsJob,
} from "../ats";

describe("detectAtsBoard", () => {
  it("detects a Greenhouse embed script and captures the token", () => {
    const html = `<div id="grnhse_app"></div>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acmecorp"></script>`;
    expect(detectAtsBoard(html)).toEqual({
      provider: "greenhouse",
      token: "acmecorp",
      boardUrl: "https://boards.greenhouse.io/acmecorp",
    });
  });

  it("detects a Greenhouse direct board link", () => {
    const html = `<a href="https://boards.greenhouse.io/acme">See open roles</a>`;
    expect(detectAtsBoard(html)?.token).toBe("acme");
  });

  it("detects a Lever board link", () => {
    const html = `<a href="https://jobs.lever.co/widgets">careers</a>`;
    // "widgets" is a real token here, not denylisted
    const board = detectAtsBoard(`<a href="https://jobs.lever.co/superco">careers</a>`);
    expect(board).toEqual({
      provider: "lever",
      token: "superco",
      boardUrl: "https://jobs.lever.co/superco",
    });
    expect(detectAtsBoard(html)?.provider).toBe("lever");
  });

  it("detects Ashby, SmartRecruiters, Recruitee, Workable", () => {
    expect(detectAtsBoard(`<iframe src="https://jobs.ashbyhq.com/notion"></iframe>`)?.token).toBe(
      "notion",
    );
    expect(
      detectAtsBoard(`<a href="https://jobs.smartrecruiters.com/Bosch">jobs</a>`)?.provider,
    ).toBe("smartrecruiters");
    expect(detectAtsBoard(`<a href="https://acme.recruitee.com/">careers</a>`)?.token).toBe("acme");
    expect(detectAtsBoard(`<a href="https://apply.workable.com/acme/">jobs</a>`)?.provider).toBe(
      "workable",
    );
  });

  it("returns null when no ATS is referenced", () => {
    expect(detectAtsBoard(`<h1>Careers</h1><p>Email us at jobs@acme.com</p>`)).toBeNull();
  });

  it("skips denylisted segments (boards.greenhouse.io/embed without a token)", () => {
    // No `for=`, only the /embed path → "embed" is denylisted, so no false token.
    const html = `<script src="https://boards.greenhouse.io/embed/job_board/js"></script>`;
    expect(detectAtsBoard(html)).toBeNull();
  });
});

describe("appendAtsJobsToHtml → parseAtsJobsFromHtml round-trip", () => {
  const board = { provider: "lever", token: "acme", boardUrl: "https://jobs.lever.co/acme" };
  const jobs: AtsJob[] = [
    { title: "Senior Backend Engineer", department: "Engineering", location: "Paris", url: "https://jobs.lever.co/acme/1" },
    { title: "Product Designer", department: "Design", location: null, url: null },
  ];

  it("embeds a parseable JSON island and keeps the postings visible", () => {
    const html = appendAtsJobsToHtml("<html><body><h1>Careers</h1></body></html>", board, jobs);
    // Visible list survives for change detection.
    expect(html).toContain("Senior Backend Engineer");
    expect(html).toContain("</body>");
    // Island round-trips back to the same set of postings (order-independent).
    const byTitle = (a: AtsJob, b: AtsJob) => a.title.localeCompare(b.title);
    expect([...(parseAtsJobsFromHtml(html) ?? [])].sort(byTitle)).toEqual([...jobs].sort(byTitle));
  });

  it("neutralises a </script> injection in a posting field", () => {
    const evil: AtsJob[] = [
      { title: "Hacker </script><script>alert(1)</script>", department: "Eng", location: null, url: null },
    ];
    const html = appendAtsJobsToHtml("<html><body></body></html>", board, evil);
    // The raw HTML must not contain an early unescaped closing tag from the title.
    const islandStart = html.indexOf(`id="outrival-ats-jobs"`);
    const firstClose = html.indexOf("</script>", islandStart);
    // Everything between the island open and its (single) close is one JSON blob.
    expect(html.slice(islandStart, firstClose)).not.toContain("<script>alert");
    expect(parseAtsJobsFromHtml(html)).toEqual(evil);
  });

  it("returns null when there is no island", () => {
    expect(parseAtsJobsFromHtml("<html><body><h1>Careers</h1></body></html>")).toBeNull();
  });
});
