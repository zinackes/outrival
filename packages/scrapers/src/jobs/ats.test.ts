import { test, expect, afterEach } from "bun:test";
import {
  atsBoardFromKey,
  detectAtsBoard,
  fetchAtsJobs,
  normalizeSalary,
  normalizeSeniority,
  parseAtsResponse,
  appendAtsJobsToHtml,
  parseAtsJobsFromHtml,
} from "./ats";

// ─── salary normalization ────────────────────────────────────────────────────

test("normalizeSalary: structured range object (Lever shape)", () => {
  expect(normalizeSalary({ min: 120000, max: 160000, currency: "usd" })).toEqual({
    min: 120000,
    max: 160000,
    currency: "USD",
  });
});

test("normalizeSalary: string with K suffix and en-dash", () => {
  expect(normalizeSalary("$120K – $160K")).toEqual({
    min: 120000,
    max: 160000,
    currency: "USD",
  });
});

test("normalizeSalary: euro symbol and lowercase k", () => {
  expect(normalizeSalary("€80k")).toEqual({ min: 80000, max: null, currency: "EUR" });
});

test("normalizeSalary: ISO code with grouped thousands", () => {
  expect(normalizeSalary("150,000 - 180,000 GBP")).toEqual({
    min: 150000,
    max: 180000,
    currency: "GBP",
  });
});

test("normalizeSalary: nothing parseable returns all null", () => {
  expect(normalizeSalary("Competitive")).toEqual({ min: null, max: null, currency: null });
  expect(normalizeSalary(null)).toEqual({ min: null, max: null, currency: null });
  expect(normalizeSalary(undefined)).toEqual({ min: null, max: null, currency: null });
});

// ─── seniority normalization ─────────────────────────────────────────────────

test("normalizeSeniority: explicit field wins", () => {
  expect(normalizeSeniority("Backend Engineer", "Senior")).toBe("senior");
});

test("normalizeSeniority: inferred from title", () => {
  expect(normalizeSeniority("Staff Software Engineer")).toBe("staff");
  expect(normalizeSeniority("Junior Data Analyst")).toBe("junior");
  expect(normalizeSeniority("VP of Marketing")).toBe("executive");
  expect(normalizeSeniority("Engineering Intern")).toBe("intern");
});

test("normalizeSeniority: null when nothing matches", () => {
  expect(normalizeSeniority("Software Engineer")).toBeNull();
});

// ─── per-ATS parsers (6 providers) ───────────────────────────────────────────

test("greenhouse: maps title/department/location/url + postedAt", () => {
  const jobs = parseAtsResponse("greenhouse", {
    jobs: [
      {
        title: "Senior Backend Engineer",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
        location: { name: "Remote" },
        departments: [{ name: "Engineering" }],
        first_published: "2024-03-01T10:00:00Z",
      },
    ],
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    title: "Senior Backend Engineer",
    department: "Engineering",
    location: "Remote",
    url: "https://boards.greenhouse.io/acme/jobs/1",
    seniority: "senior",
    postedAt: "2024-03-01T10:00:00.000Z",
  });
});

test("lever: structured salaryRange + createdAt epoch", () => {
  const jobs = parseAtsResponse("lever", [
    {
      text: "Account Executive",
      hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { team: "Sales", location: "NYC", commitment: "Full-time" },
      createdAt: 1709287200000,
      salaryRange: { min: 90000, max: 110000, currency: "USD", interval: "per-year-salary" },
    },
  ]);
  expect(jobs[0]).toMatchObject({
    title: "Account Executive",
    department: "Sales",
    location: "NYC",
    salaryMin: 90000,
    salaryMax: 110000,
    salaryCurrency: "USD",
  });
  expect(jobs[0]?.postedAt).toBe(new Date(1709287200000).toISOString());
});

test("ashby: compensationTierSummary parsed into a range", () => {
  const jobs = parseAtsResponse("ashby", {
    jobs: [
      {
        title: "Principal Engineer",
        jobUrl: "https://jobs.ashbyhq.com/acme/1",
        department: "Engineering",
        location: "SF",
        isListed: true,
        compensation: { compensationTierSummary: "$180K – $220K" },
      },
    ],
  });
  expect(jobs[0]).toMatchObject({
    seniority: "principal",
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: "USD",
  });
});

test("ashby: unlisted jobs are dropped", () => {
  const jobs = parseAtsResponse("ashby", {
    jobs: [{ title: "Hidden", isListed: false }],
  });
  expect(jobs).toHaveLength(0);
});

test("smartrecruiters: nested location + releasedDate", () => {
  const jobs = parseAtsResponse(
    "smartrecruiters",
    {
      content: [
        {
          id: "abc",
          name: "Data Scientist",
          location: { city: "Berlin", country: "DE" },
          department: { label: "Data" },
          releasedDate: "2024-02-10T00:00:00Z",
        },
      ],
    },
    "acme",
  );
  expect(jobs[0]).toMatchObject({
    title: "Data Scientist",
    department: "Data",
    location: "Berlin, DE",
    url: "https://jobs.smartrecruiters.com/acme/abc",
    postedAt: "2024-02-10T00:00:00.000Z",
  });
});

test("recruitee: structured salary object + published_at", () => {
  const jobs = parseAtsResponse("recruitee", {
    offers: [
      {
        title: "Lead Designer",
        city: "Amsterdam",
        country: "NL",
        department: "Design",
        careers_url: "https://acme.recruitee.com/o/lead-designer",
        published_at: "2024-01-05T00:00:00Z",
        salary: { min: 70000, max: 90000, currency: "EUR" },
      },
    ],
  });
  expect(jobs[0]).toMatchObject({
    title: "Lead Designer",
    location: "Amsterdam, NL",
    seniority: "lead",
    salaryMin: 70000,
    salaryMax: 90000,
    salaryCurrency: "EUR",
  });
});

test("personio: parses XML feed with seniority + createdAt", () => {
  const xml = `<?xml version="1.0"?><workzag-jobs>
    <position>
      <id>987</id>
      <name><![CDATA[Senior Platform Engineer]]></name>
      <department>Engineering</department>
      <office>Munich</office>
      <seniority>senior</seniority>
      <createdAt>2024-04-01T08:00:00+02:00</createdAt>
    </position>
    <position>
      <id>988</id>
      <name>Working Student Marketing</name>
      <department>Marketing</department>
      <office>Berlin</office>
      <seniority>entry-level</seniority>
      <createdAt>2024-04-02T08:00:00+02:00</createdAt>
    </position>
  </workzag-jobs>`;
  const jobs = parseAtsResponse("personio", xml, "acme");
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toMatchObject({
    title: "Senior Platform Engineer",
    department: "Engineering",
    location: "Munich",
    url: "https://acme.jobs.personio.com/job/987",
    seniority: "senior",
  });
  expect(jobs[1]?.seniority).toBe("junior"); // "entry-level" → junior
});

test("personio board detected from careers HTML", () => {
  const board = detectAtsBoard('<a href="https://acme.jobs.personio.com/">Jobs</a>');
  expect(board).toEqual({
    provider: "personio",
    token: "acme",
    boardUrl: "https://acme.jobs.personio.com/",
  });
});

// ─── Welcome to the Jungle (Algolia search index) ────────────────────────────

test("welcometothejungle: parses Algolia hits with salary + english department", () => {
  const jobs = parseAtsResponse("welcometothejungle", {
    hits: [
      {
        name: "Senior Backend Engineer",
        slug: "senior-backend-engineer_paris",
        organization: { slug: "dougs" },
        offices: [{ city: "Paris", country: "France" }],
        new_profession: { category_name: "Tech & Engineering" },
        salary_minimum: 60000,
        salary_maximum: 75000,
        salary_currency: "EUR",
        published_at: "2026-07-04T02:00:04Z",
        experience_level_minimum: null,
      },
      { name: "" }, // untitled hit is dropped
    ],
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    title: "Senior Backend Engineer",
    department: "Tech & Engineering",
    location: "Paris, France",
    url: "https://www.welcometothejungle.com/en/companies/dougs/jobs/senior-backend-engineer_paris",
    seniority: "senior", // inferred from the title (no explicit ATS level)
    salaryMin: 60000,
    salaryMax: 75000,
    salaryCurrency: "EUR",
  });
});

test("welcometothejungle board detected from careers HTML (org slug, /jobs sub-path)", () => {
  const board = detectAtsBoard(
    '<a href="https://www.welcometothejungle.com/fr/companies/dougs/jobs">Nos offres</a>',
  );
  expect(board).toEqual({
    provider: "welcometothejungle",
    token: "dougs",
    boardUrl: "https://www.welcometothejungle.com/en/companies/dougs/jobs",
  });
});

test("rebuilds a Welcome to the Jungle board from a profile key", () => {
  expect(atsBoardFromKey("welcometothejungle:dougs")?.boardUrl).toBe(
    "https://www.welcometothejungle.com/en/companies/dougs/jobs",
  );
});

// ─── JSON island round-trip carries enrichment ───────────────────────────────

test("appendAtsJobsToHtml → parseAtsJobsFromHtml preserves salary + seniority", () => {
  const board = { provider: "lever", token: "acme", boardUrl: "https://jobs.lever.co/acme" };
  const jobs = parseAtsResponse("lever", [
    {
      text: "Senior Engineer",
      hostedUrl: "https://jobs.lever.co/acme/1",
      categories: { team: "Eng" },
      createdAt: 1709287200000,
      salaryRange: { min: 90000, max: 110000, currency: "USD" },
    },
  ]);
  const html = appendAtsJobsToHtml("<html><body></body></html>", board, jobs);
  expect(html).toContain("USD 90,000–110,000");
  const parsed = parseAtsJobsFromHtml(html);
  expect(parsed?.[0]).toMatchObject({
    title: "Senior Engineer",
    seniority: "senior",
    salaryMin: 90000,
    salaryMax: 110000,
    salaryCurrency: "USD",
    postedAt: new Date(1709287200000).toISOString(),
  });
});

test("rebuilds a Greenhouse board from a profile key", () => {
  const board = atsBoardFromKey("greenhouse:airbnb");
  expect(board).toEqual({
    provider: "greenhouse",
    token: "airbnb",
    boardUrl: "https://boards.greenhouse.io/airbnb",
  });
});

test("rebuilds a Lever board (provider-specific board URL)", () => {
  expect(atsBoardFromKey("lever:netflix")?.boardUrl).toBe("https://jobs.lever.co/netflix");
});

test("returns null for an unknown provider", () => {
  expect(atsBoardFromKey("teamtailor:acme")).toBeNull();
});

test("returns null for a malformed key", () => {
  expect(atsBoardFromKey("greenhouse")).toBeNull();
  expect(atsBoardFromKey(":airbnb")).toBeNull();
  expect(atsBoardFromKey("greenhouse:")).toBeNull();
});

// ─── Lever mode=json HTML trap ───────────────────────────────────────────────
// A malformed/unknown Lever token makes `?mode=json` return an HTML page with a
// 200 status. It must be detected and fail cleanly (null → link-follow fallback),
// never be treated as a successful snapshot.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(body: string, contentType: string, status = 200) {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { "content-type": contentType } })) as typeof fetch;
}

test("Lever mode=json returning HTML (200) fails cleanly to null", async () => {
  stubFetch("<!doctype html><html><body>Not found</body></html>", "text/html; charset=utf-8");
  const { jobs } = await fetchAtsJobs({
    provider: "lever",
    token: "does-not-exist",
    boardUrl: "https://jobs.lever.co/does-not-exist",
  });
  expect(jobs).toBeNull();
});

test("Lever mode=json returning real JSON is parsed", async () => {
  stubFetch(
    JSON.stringify([
      { text: "Staff Engineer", categories: { team: "Engineering", location: "Remote" }, hostedUrl: "https://jobs.lever.co/acme/1" },
    ]),
    "application/json",
  );
  const { jobs } = await fetchAtsJobs({
    provider: "lever",
    token: "acme",
    boardUrl: "https://jobs.lever.co/acme",
  });
  expect(jobs).not.toBeNull();
  expect(jobs).toHaveLength(1);
  expect(jobs![0]!.title).toBe("Staff Engineer");
});

// ─── JD bodies (Hiring Intelligence v2 P1) ───────────────────────────────────
//
// The bodies were already in these responses and were parsed and discarded. Each
// provider ships them in a different shape, so each mapping gets a fixture; the
// providers whose LIST payload carries no body must stay null rather than invent
// one, because a null description is "not mined" and an empty string is a JD that
// states nothing.

test("greenhouse: content=true body is captured and stripped to text", () => {
  const jobs = parseAtsResponse("greenhouse", {
    jobs: [
      {
        title: "Backend Engineer",
        content: "<p>We run on <strong>Kubernetes</strong> &amp; Go.</p>",
      },
    ],
  });
  expect(jobs[0]?.description).toBe("We run on Kubernetes & Go.");
});

test("lever: descriptionPlain plus the numbered lists that hold the content", () => {
  const jobs = parseAtsResponse("lever", [
    {
      text: "Platform Engineer",
      categories: { team: "Engineering", commitment: "Full-time" },
      descriptionPlain: "We are building a new billing platform.",
      lists: [{ text: "Requirements", content: "<li>Rust experience</li>" }],
    },
  ]);
  expect(jobs[0]?.description).toBe(
    "We are building a new billing platform.\n\nRequirements\n\nRust experience",
  );
  expect(jobs[0]?.employmentType).toBe("Full-time");
});

test("ashby: descriptionPlain + employmentType", () => {
  const jobs = parseAtsResponse("ashby", {
    jobs: [
      {
        title: "Data Engineer",
        descriptionPlain: "You will migrate our warehouse to Snowflake.",
        employmentType: "FullTime",
      },
    ],
  });
  expect(jobs[0]?.description).toBe("You will migrate our warehouse to Snowflake.");
  expect(jobs[0]?.employmentType).toBe("FullTime");
});

test("workable: details=true splits the body across description/requirements/benefits", () => {
  const jobs = parseAtsResponse("workable", {
    jobs: [
      {
        title: "Site Reliability Engineer",
        description: "<p>Own our infrastructure.</p>",
        requirements: "<p>Terraform.</p>",
        benefits: "<p>Stock.</p>",
        employment_type: "Full-time",
      },
    ],
  });
  expect(jobs[0]?.description).toBe("Own our infrastructure.\n\nTerraform.\n\nStock.");
  expect(jobs[0]?.employmentType).toBe("Full-time");
});

test("recruitee: description + requirements", () => {
  const jobs = parseAtsResponse("recruitee", {
    offers: [{ title: "Product Manager", description: "<p>Launch a new vertical.</p>" }],
  });
  expect(jobs[0]?.description).toBe("Launch a new vertical.");
});

test("personio: named jobDescription sections are joined in order", () => {
  const xml = `<?xml version="1.0"?><workzag-jobs>
    <position>
      <id>1</id>
      <name>Backend Engineer</name>
      <department>Engineering</department>
      <employmentType>permanent</employmentType>
      <jobDescriptions>
        <jobDescription><name>Tasks</name><value><![CDATA[<p>Build services in Go.</p>]]></value></jobDescription>
        <jobDescription><name>Requirements</name><value><![CDATA[<p>Kubernetes.</p>]]></value></jobDescription>
      </jobDescriptions>
    </position>
  </workzag-jobs>`;
  const jobs = parseAtsResponse("personio", xml, "acme");
  expect(jobs[0]?.description).toBe("Tasks\nBuild services in Go.\n\nRequirements\nKubernetes.");
  expect(jobs[0]?.employmentType).toBe("permanent");
});

test("a provider whose list payload carries no body yields null, never an empty JD", () => {
  const workday = parseAtsResponse(
    "workday",
    { jobPostings: [{ title: "Analyst", externalPath: "/job/1" }] },
    "acme.wd5.myworkdayjobs.com/External",
  );
  expect(workday[0]?.description).toBeNull();

  const greenhouse = parseAtsResponse("greenhouse", {
    jobs: [{ title: "Analyst", content: "  " }],
  });
  expect(greenhouse[0]?.description).toBeNull();
});

test("the JSON island round-trips the description and employment type", () => {
  const board = { provider: "greenhouse", token: "acme", boardUrl: "https://x" };
  const jobs = parseAtsResponse("greenhouse", {
    jobs: [{ title: "Backend Engineer", content: "<p>We run on Kubernetes.</p>" }],
  });
  const html = appendAtsJobsToHtml("<html><body></body></html>", board, jobs);
  const parsed = parseAtsJobsFromHtml(html);
  expect(parsed?.[0]?.description).toBe("We run on Kubernetes.");
});
