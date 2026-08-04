import { describe, expect, test } from "bun:test";
import {
  COMPARISON_INDEX_PATHS,
  comparisonTargetsFromUrl,
  comparisonTargetsFromUrls,
  looksLikeComparisonIndex,
  parseComparisonIndex,
  planComparisonRun,
  prettifySlug,
} from "./comparison-targets";
import { matchTrackedCompetitor, routeComparisonUrl, targetIsSelf } from "./target-identity";

const HOST = "https://rival.com";
const names = (url: string) => comparisonTargetsFromUrl(url).map((h) => h.displayName);

describe("the patterns a comparison URL can take", () => {
  test("a section with a child slug names the child", () => {
    expect(names(`${HOST}/vs/klue`)).toEqual(["Klue"]);
    expect(names(`${HOST}/versus/klue`)).toEqual(["Klue"]);
    expect(names(`${HOST}/compare/klue`)).toEqual(["Klue"]);
    expect(names(`${HOST}/comparison/klue`)).toEqual(["Klue"]);
    expect(names(`${HOST}/alternatives/klue`)).toEqual(["Klue"]);
  });

  test("the suffix pattern names the prefix", () => {
    expect(names(`${HOST}/klue-alternative`)).toEqual(["Klue"]);
    expect(names(`${HOST}/klue-alternatives`)).toEqual(["Klue"]);
    expect(names(`${HOST}/best/kompyte-alternatives/`)).toEqual(["Kompyte"]);
  });

  test("an a-vs-b segment names BOTH sides", () => {
    expect(names(`${HOST}/klue-vs-crayon`)).toEqual(["Klue", "Crayon"]);
    expect(names(`${HOST}/vs/klue-vs-crayon`)).toEqual(["Klue", "Crayon"]);
    expect(names(`${HOST}/blog/klue-versus-crayon`)).toEqual(["Klue", "Crayon"]);
    // Three-way pages exist and each name in one is a target.
    expect(names(`${HOST}/klue-vs-crayon-vs-kompyte`)).toEqual(["Klue", "Crayon", "Kompyte"]);
  });

  test("multi-word slugs are prettified, two-letter words upper-cased", () => {
    expect(names(`${HOST}/vs/microsoft-teams`)).toEqual(["Microsoft Teams"]);
    // Not a typo: a comparison slug is full of two-letter product words.
    expect(prettifySlug(["hr", "cloud"])).toBe("HR Cloud");
    // The page describes ITSELF here, not the rival — dropped so /vs/klue and
    // /vs/klue-comparison are one target rather than two.
    expect(names(`${HOST}/vs/klue-comparison`)).toEqual(["Klue"]);
  });

  test("the source says which kind of page named them", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/vs/klue`)[0]!.source).toBe("vs_page");
    expect(comparisonTargetsFromUrl(`${HOST}/klue-alternative`)[0]!.source).toBe(
      "alternatives_page",
    );
    expect(comparisonTargetsFromUrl(`${HOST}/alternatives/klue`)[0]!.source).toBe(
      "alternatives_page",
    );
  });
});

describe("what a slug is NOT allowed to become", () => {
  test("generic slugs name nobody", () => {
    for (const slug of ["all", "features", "pricing", "tools", "index", "software", "best"]) {
      expect(comparisonTargetsFromUrl(`${HOST}/vs/${slug}`)).toEqual([]);
    }
  });

  test("a bare hub names nobody", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/compare`)).toEqual([]);
    expect(comparisonTargetsFromUrl(`${HOST}/vs/`)).toEqual([]);
    expect(comparisonTargetsFromUrl(`${HOST}/alternatives`)).toEqual([]);
  });

  test("a non-comparison URL names nobody", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/pricing`)).toEqual([]);
    expect(comparisonTargetsFromUrl(`${HOST}/blog/how-we-scaled`)).toEqual([]);
  });

  test("a file, a number, or a sentence is not a name", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/vs/index.html`)).toEqual([]);
    expect(comparisonTargetsFromUrl(`${HOST}/vs/node.js`)).toEqual([]);
    expect(comparisonTargetsFromUrl(`${HOST}/vs/42`)).toEqual([]);
    expect(
      comparisonTargetsFromUrl(`${HOST}/vs/why-we-are-better-than-everyone-else-in-2026`),
    ).toEqual([]);
  });

  test("a two-letter name is below the floor", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/vs/hi`)).toEqual([]);
  });
});

describe("named_domain is read, never guessed", () => {
  test("a slug that IS a domain fills it", () => {
    const hit = comparisonTargetsFromUrl(`${HOST}/vs/crayon.co`)[0]!;
    expect(hit.namedDomain).toBe("crayon.co");
    expect(hit.displayName).toBe("Crayon");
  });

  test("a slug that is only a name leaves it null", () => {
    expect(comparisonTargetsFromUrl(`${HOST}/vs/crayon`)[0]!.namedDomain).toBeNull();
    expect(comparisonTargetsFromUrl(`${HOST}/vs/monday.com`)[0]!.namedDomain).toBe("monday.com");
  });
});

describe("a set of URLs", () => {
  test("dedupes on the registry key — name AND source", () => {
    const hits = comparisonTargetsFromUrls([
      `${HOST}/vs/klue`,
      `${HOST}/vs/klue/`, // the same page, the same row
      `${HOST}/klue-alternative`, // a DIFFERENT page about the same rivalry
      `${HOST}/pricing`,
    ]);
    // Two rows, because the map shows both pages. The SIGNAL deduplicates on the
    // name for life; collapsing them here would throw the second page away.
    expect(hits.map((h) => h.source)).toEqual(["vs_page", "alternatives_page"]);
    expect(hits[0]!.evidenceUrl).toBe(`${HOST}/vs/klue`);
  });
});

describe("the comparison hub", () => {
  const hub = (hrefs: string[]) =>
    `<!doctype html><html><head><title>Compare | Rival</title></head><body>
      <h1>Compare Rival</h1>
      <p>Klue and Crayon are the two names people mention most.</p>
      ${hrefs.map((h) => `<a href="${h}">See how we compare</a>`).join("\n")}
    </body></html>`;

  test("reads its LINKS and never its prose", () => {
    // Kompyte appears only in a sentence; the links name Klue and Crayon.
    const html = hub(["/vs/klue", "/compare/crayon", "/pricing"]).replace(
      "</body>",
      "<p>Kompyte is also a comparison people make.</p></body>",
    );
    expect(parseComparisonIndex(html, `${HOST}/compare`).map((h) => h.displayName)).toEqual([
      "Klue",
      "Crayon",
    ]);
  });

  test("ignores links off their own domain", () => {
    const html = hub(["https://elsewhere.com/vs/klue", "/vs/crayon"]);
    expect(parseComparisonIndex(html, `${HOST}/compare`).map((h) => h.displayName)).toEqual([
      "Crayon",
    ]);
  });

  test("a page linking to one comparison is not a hub", () => {
    expect(looksLikeComparisonIndex(hub(["/vs/klue"]), `${HOST}/compare`)).toBe(false);
    expect(looksLikeComparisonIndex(hub(["/vs/klue", "/vs/crayon"]), `${HOST}/compare`)).toBe(true);
  });

  test("a homepage served for an unknown path is not a hub", () => {
    const homepage = `<!doctype html><html><body><h1>Rival</h1><a href="/pricing">Pricing</a></body></html>`;
    expect(looksLikeComparisonIndex(homepage, `${HOST}/compare`)).toBe(false);
  });

  test("the probe stays short", () => {
    expect(COMPARISON_INDEX_PATHS).toEqual(["/vs", "/compare", "/alternatives"]);
  });
});

describe("the baseline marker", () => {
  test("is the stamp, not a row count", () => {
    expect(planComparisonRun({ baselinedAt: null }).mode).toBe("baseline");
    expect(planComparisonRun({ baselinedAt: new Date("2026-01-01") }).mode).toBe("read");
  });
});

describe("the reader's own product never enters the map", () => {
  const self = { brands: ["Outrival"], domains: ["outrival.app"] };
  const identity = (url: string) => {
    const hit = comparisonTargetsFromUrl(url)[0]!;
    return { ...hit };
  };

  test("a slug naming the workspace brand is self", () => {
    expect(targetIsSelf(identity(`${HOST}/vs/outrival`), self)).toBe(true);
    expect(targetIsSelf(identity(`${HOST}/out-rival-alternative`), self)).toBe(true);
  });

  test("a slug carrying the workspace domain is self", () => {
    expect(targetIsSelf(identity(`${HOST}/vs/outrival.app`), self)).toBe(true);
  });

  test("a brand that is an ordinary word is STILL self on a slug", () => {
    // The stoplist exists to stop prose ("our workflow is linear") from paging a
    // Linear workspace. A slug under /vs/ is a product name by construction, and
    // applying the stoplist here would file the reader's own product as a rival.
    expect(targetIsSelf(identity(`${HOST}/vs/linear`), { brands: ["Linear"], domains: [] })).toBe(
      true,
    );
  });

  test("another company is not self", () => {
    expect(targetIsSelf(identity(`${HOST}/vs/klue`), self)).toBe(false);
  });
});

describe("which signal owns a comparison page", () => {
  const brands = ["Outrival", "outrival"];

  test("a page naming the READER stays the deterministic critical", () => {
    // Untouched by this phase, and the whole reason the market map can be quieter.
    expect(routeComparisonUrl(`${HOST}/vs/outrival`, brands)).toBe("attacks_you");
    expect(routeComparisonUrl(`${HOST}/outrival-alternative`, brands)).toBe("attacks_you");
  });

  test("a page naming somebody else goes to the market map", () => {
    expect(routeComparisonUrl(`${HOST}/vs/klue`, brands)).toBe("market_map");
    expect(routeComparisonUrl(`${HOST}/klue-vs-crayon`, brands)).toBe("market_map");
  });

  test("a page naming NOBODY keeps the generic signal", () => {
    // Without this branch a competitor building a comparison hub would publish it
    // and we would say nothing at all: the map has no name to announce.
    expect(routeComparisonUrl(`${HOST}/compare`, brands)).toBe("unnamed_page");
    expect(routeComparisonUrl(`${HOST}/vs/all`, brands)).toBe("unnamed_page");
  });

  test("a page that is not a comparison at all belongs to neither", () => {
    expect(routeComparisonUrl(`${HOST}/pricing`, brands)).toBeNull();
  });
});

describe("recognising a competitor the workspace tracks", () => {
  const target = (url: string) => ({ ...comparisonTargetsFromUrl(url)[0]! });

  test("a domain stands on its own, subdomains included", () => {
    expect(
      matchTrackedCompetitor(target(`${HOST}/vs/crayon.co`), {
        name: "Crayon Data",
        url: "https://www.crayon.co",
      }),
    ).toBe("domain");
    expect(
      matchTrackedCompetitor(target(`${HOST}/vs/app.crayon.co`), {
        name: "Whatever",
        url: "https://crayon.co",
      }),
    ).toBe("domain");
  });

  test("a distinctive brand matches on the name alone", () => {
    expect(
      matchTrackedCompetitor(target(`${HOST}/vs/klue`), { name: "Klue", url: "https://klue.com" }),
    ).toBe("brand");
  });

  test("a brand that is an ordinary word needs the domain", () => {
    // Here the failure mode is inverted: without the stoplist, every /compare/flow
    // page on the internet would be reported as naming this workspace's rival.
    expect(
      matchTrackedCompetitor(target(`${HOST}/compare/flow`), { name: "Flow", url: null }),
    ).toBeNull();
    expect(
      matchTrackedCompetitor(target(`${HOST}/compare/flow.app`), {
        name: "Flow",
        url: "https://flow.app",
      }),
    ).toBe("domain");
  });

  test("a different company does not match", () => {
    expect(
      matchTrackedCompetitor(target(`${HOST}/vs/klue`), {
        name: "Kompyte",
        url: "https://kompyte.com",
      }),
    ).toBeNull();
  });
});
