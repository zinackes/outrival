import { afterEach, describe, expect, it } from "bun:test";
import {
  detectAtsBoard,
  detectAtsEmbed,
  detectAtsPlatform,
  appendAtsJobsToHtml,
  parseAtsJobsFromHtml,
  parseAtsResponse,
  atsBoardFromKey,
  fetchAtsJobs,
  isApiAdapter,
  type AtsJob,
} from "../ats";

describe("detectAtsEmbed — boards injected client-side", () => {
  // Both shapes below are the real SSR markup, taken off the two competitors in
  // the fleet whose board is embedded rather than linked.
  it("names Ashby from an empty embed container (clickup.com)", () => {
    const html = `<div class="jobBoardContainer"><div id="ashby_embed" class="ashbyEmbed"></div></div>`;
    expect(detectAtsEmbed(html)).toBe("ashby");
    // …and there is no board to find, which is exactly the problem it reports.
    expect(detectAtsBoard(html)).toBeNull();
    expect(detectAtsPlatform(html)).toBe("ashby");
  });

  it("names Greenhouse from an empty embed container (later.com)", () => {
    const html = `<div class="gc-span-8 offset-4"><div id="grnhse_app"></div></div>`;
    expect(detectAtsEmbed(html)).toBe("greenhouse");
    expect(detectAtsBoard(html)).toBeNull();
    expect(detectAtsPlatform(html)).toBe("greenhouse");
  });

  it("prefers the real board over the container when both are present", () => {
    // Once the embed script has run, the token is there and it wins: a named
    // board is a strictly stronger read than a vendor name with no board.
    const html = `<div id="ashby_embed"></div>
      <script src="https://jobs.ashbyhq.com/clickup/embed?version=2"></script>`;
    expect(detectAtsPlatform(html)).toBe("ashby");
    expect(detectAtsBoard(html)).toEqual({
      provider: "ashby",
      token: "clickup",
      boardUrl: "https://jobs.ashbyhq.com/clickup",
    });
  });

  it("only an API-adapter island key may be remembered as a board", () => {
    // A jobs scrape writes the board it resolved onto competitors.platform_profile
    // so the next run skips discovery (rememberAtsBoard). The island's `token` is
    // only a board token on the API rungs — on the schema.org rung it is the HOST
    // the listing was read from, and the two are indistinguishable in the key.
    //
    // `atsBoardFromKey` cannot tell them apart: teamtailor HAS a PROVIDERS entry
    // (for its board URL) with no `api`, so the key round-trips happily into a URL
    // that is pure nonsense. isApiAdapter is the guard that actually holds, which
    // is why the memo checks it FIRST and does not rely on the round-trip alone.
    expect(atsBoardFromKey("teamtailor:jobs.acme.com")?.boardUrl).toBe(
      "https://jobs.acme.com.teamtailor.com/jobs",
    );
    expect(isApiAdapter("teamtailor")).toBe(false);
    expect(isApiAdapter("generic")).toBe(false);
    // The two embedded-board vendors, which are exactly what the memo exists for.
    expect(isApiAdapter("ashby")).toBe(true);
    expect(atsBoardFromKey("ashby:clickup")?.boardUrl).toBe("https://jobs.ashbyhq.com/clickup");
    expect(isApiAdapter("greenhouse")).toBe(true);
    expect(atsBoardFromKey("greenhouse:later")?.boardUrl).toBe("https://boards.greenhouse.io/later");
  });

  it("does not fire on a page that merely mentions the vendors", () => {
    // The markers are the vendors' container ids, matched whole. A blog post about
    // hiring tools must never be filed as a board in the coverage counter, and a
    // loose marker is how that happens — `rt-widget` matched a shopping cart.
    const html = `<p>We compared Ashby, Greenhouse and Lever before choosing one.</p>
      <div data-shopping-cart-widget="true"></div><div id="grnhse_app_wrapper_v2"></div>`;
    expect(detectAtsEmbed(html)).toBeNull();
    expect(detectAtsPlatform(html)).toBeNull();
  });
});

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
  const enrichment = {
    seniority: null,
    postedAt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    description: null,
    employmentType: null,
  };
  const jobs: AtsJob[] = [
    { title: "Senior Backend Engineer", department: "Engineering", location: "Paris", url: "https://jobs.lever.co/acme/1", ...enrichment },
    { title: "Product Designer", department: "Design", location: null, url: null, ...enrichment },
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
      { title: "Hacker </script><script>alert(1)</script>", department: "Eng", location: null, url: null, ...enrichment },
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

// One iCIMS job card, matching the live portal markup: the title sits in an <h3>
// inside the anchor, and the extra fields are <dt>/<dd> pairs whose LABEL itself
// carries markup (a glyph icon plus an sr-only caption).
function icimsCard(id: string, title: string, extra = ""): string {
  return `<li class="iCIMS_JobCardItem">
    <div class="row">
      <div class="col-xs-12 title">
        <a href="https://careers-acme.icims.com/jobs/${id}/x/job" class="iCIMS_Anchor" title="${id} - ${title}">
          <span class="sr-only field-label">Title</span>
          <h3 >
${title}</h3>
        </a>
      </div>
      <div class="col-xs-12 additionalFields">
        <dl class="iCIMS_JobHeaderGroup">
          <div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">ID</dt><dd class="iCIMS_JobHeaderData"><span >2026-${id}</span></dd></div>
          ${extra}
        </dl>
      </div>
    </div>
  </li>`;
}

const icimsLocationField = `<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField"><span class="glyphicons glyphicons-map-marker" aria-hidden="true"></span>
  <span class="sr-only field-label">Location : Location</span></dt><dd class="iCIMS_JobHeaderData"><span >US-KY-Owensboro</span></dd></div>`;
const icimsCategoryField = `<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">Category</dt><dd class="iCIMS_JobHeaderData"><span >Information Technology</span></dd></div>`;

describe("detectAtsBoard — Workday & iCIMS", () => {
  it("detects a Workday careers link and keeps host + site in the token", () => {
    const html = `<a href="https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite">Careers</a>`;
    expect(detectAtsBoard(html)).toEqual({
      provider: "workday",
      token: "nvidia.wd5.myworkdayjobs.com/nvidiaexternalcareersite",
      boardUrl: "https://nvidia.wd5.myworkdayjobs.com/nvidiaexternalcareersite",
    });
  });

  it("drops the locale segment from a localised Workday link", () => {
    // …/en-US/<site> must not resolve the site to "en-us", which would 404 the API.
    const html = `<a href="https://acme.wd3.myworkdayjobs.com/en-US/AcmeCareers">Jobs</a>`;
    expect(detectAtsBoard(html)?.boardUrl).toBe("https://acme.wd3.myworkdayjobs.com/acmecareers");
  });

  it("detects an iCIMS customer portal", () => {
    const html = `<iframe src="https://careers-acme.icims.com/jobs/search?ss=1"></iframe>`;
    expect(detectAtsBoard(html)).toEqual({
      provider: "icims",
      token: "careers-acme.icims.com",
      boardUrl: "https://careers-acme.icims.com/jobs/search?ss=1",
    });
  });

  it("ignores iCIMS asset hosts rather than mistaking one for a board", () => {
    // Regression: an unanchored host pattern restarts mid-string and turns
    // `cdn02.icims.com` into the token `dn02.icims.com`, which then 404s forever.
    const html = `<script src="https://cdn02.icims.com/a/platform/script/main.js"></script>
      <img src="https://images.icims.com/logo.png">`;
    expect(detectAtsBoard(html)).toBeNull();
  });

  it("round-trips a Workday composite token through the platform-profile key", () => {
    const key = "workday:acme.wd3.myworkdayjobs.com/acmecareers";
    expect(atsBoardFromKey(key)?.token).toBe("acme.wd3.myworkdayjobs.com/acmecareers");
  });
});

describe("parseAtsResponse — Workday", () => {
  it("maps postings and builds the absolute apply URL", () => {
    const data = {
      total: 2,
      jobPostings: [
        {
          title: "Logic Design Engineer, CPU Core",
          externalPath: "/job/Israel-Yokneam/Logic-Design-Engineer_JR2015261",
          locationsText: "Israel, Yokneam",
          postedOn: "Posted Today",
        },
        { title: "", externalPath: "/job/x", locationsText: "Remote" },
      ],
    };
    const jobs = parseAtsResponse("workday", data, "nvidia.wd5.myworkdayjobs.com/site");
    // The untitled posting is dropped.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Logic Design Engineer, CPU Core",
      location: "Israel, Yokneam",
      url: "https://nvidia.wd5.myworkdayjobs.com/site/job/Israel-Yokneam/Logic-Design-Engineer_JR2015261",
      // "Posted Today" is relative prose, not a date — never coerced into one.
      postedAt: null,
    });
  });

  it("returns nothing for a payload without jobPostings", () => {
    expect(parseAtsResponse("workday", { total: 0 }, "a.wd1.myworkdayjobs.com/s")).toEqual([]);
  });
});

describe("parseAtsResponse — iCIMS", () => {
  it("reads title, apply URL and the tenant's configured fields", () => {
    const html = `<ul class="iCIMS_JobsTable">
      ${icimsCard("3011", "Analyst, Systems", icimsCategoryField + icimsLocationField)}
    </ul>`;
    const jobs = parseAtsResponse("icims", html, "careers-acme.icims.com");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Analyst, Systems",
      department: "Information Technology",
      location: "US-KY-Owensboro",
      url: "https://careers-acme.icims.com/jobs/3011/x/job",
    });
  });

  it("still yields the posting when the portal exposes no category or location", () => {
    // Field labels are configured per tenant: some portals carry only an ID, so
    // title + apply URL are the only guaranteed columns.
    const jobs = parseAtsResponse("icims", icimsCard("42", "Corporate Counsel"), "acme.icims.com");
    expect(jobs[0]).toMatchObject({ title: "Corporate Counsel", department: "Other", location: null });
  });

  it("returns nothing for a portal page with no job cards", () => {
    expect(parseAtsResponse("icims", "<html><body>No results found</body></html>")).toEqual([]);
  });
});

describe("fetchAtsJobs — paginated boards", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubIcims(pages: string[]): string[] {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      const pr = Number(/[?&]pr=(\d+)/.exec(String(url))?.[1] ?? 0);
      return new Response(pages[pr] ?? "<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    return seen;
  }

  const board = {
    provider: "icims",
    token: "careers-acme.icims.com",
    boardUrl: "https://careers-acme.icims.com/jobs/search?ss=1",
  };

  it("walks pages and stops at the first one that adds nothing new", async () => {
    const seen = stubIcims([icimsCard("1", "Engineer A"), icimsCard("2", "Engineer B"), ""]);
    const { jobs } = await fetchAtsJobs(board);
    expect(jobs?.map((j) => j.title)).toEqual(["Engineer A", "Engineer B"]);
    // 3 requests: two productive pages plus the empty one that ended the walk.
    expect(seen).toHaveLength(3);
  });

  it("keeps postings that repeat a title at different locations", async () => {
    // Real shape: one "Financial Services Representative" per branch. Keying the
    // dedup on the title alone would collapse them and under-count the board.
    stubIcims([icimsCard("1", "Rep") + icimsCard("2", "Rep"), ""]);
    expect((await fetchAtsJobs(board)).jobs).toHaveLength(2);
  });

  it("discards a board that was still yielding when the page cap ran out", async () => {
    // A truncated list must not reach the caller: it is treated as the authoritative
    // set of open roles, so everything past the cap would be diffed as closed.
    globalThis.fetch = (async (url: string) => {
      const pr = Number(/[?&]pr=(\d+)/.exec(String(url))?.[1] ?? 0);
      return new Response(icimsCard(String(pr), `Role ${pr}`), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    // `truncated` is what tells the scraper the BOARD PAGE is an arbitrary slice
    // too, so following its link is not a useful fallback either.
    expect(await fetchAtsJobs(board)).toEqual({ jobs: null, truncated: true });
  });

  it("bails after one request when the board declares more roles than the cap covers", async () => {
    // Workday sends `total` on the first page, so an over-cap board is known to be
    // uncoverable immediately — walking 25 pages only to throw them away costs ~28s.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          total: 2000,
          jobPostings: [{ title: "Engineer", externalPath: "/job/1", locationsText: "Remote" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const wd = {
      provider: "workday",
      token: "acme.wd3.myworkdayjobs.com/acmecareers",
      boardUrl: "https://acme.wd3.myworkdayjobs.com/acmecareers",
    };
    expect(await fetchAtsJobs(wd)).toEqual({ jobs: null, truncated: true });
    expect(calls).toBe(1);
  });

  it("keeps what it already read when a page mid-walk fails", async () => {
    globalThis.fetch = (async (url: string) => {
      const pr = Number(/[?&]pr=(\d+)/.exec(String(url))?.[1] ?? 0);
      if (pr >= 1) return new Response("nope", { status: 500 });
      return new Response(icimsCard("1", "Engineer A"), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    expect((await fetchAtsJobs(board)).jobs?.map((j) => j.title)).toEqual(["Engineer A"]);
  });
});
