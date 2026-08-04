import { describe, expect, test } from "bun:test";
import {
  audiencePageFromUrl,
  audiencePagesFromUrls,
  isAudienceUrl,
  looksLikeAudienceIndex,
  parseAudienceIndex,
  planAudienceRun,
} from "./audience-pages";
import { resolveIndustry } from "@outrival/shared";

/**
 * The ICP reader (Positioning Intelligence v2 P3).
 *
 * What is asserted here is the shape of the silence: a registry entry is permanent
 * and it is supposed to describe someone's ICP, so a slug we cannot map, a hub root,
 * or a sub-page has to produce NOTHING rather than a fourth kind nobody defined.
 */

const HOST = "https://rival.com";

describe("the kind mapping", () => {
  test("EN sections map to their kind", () => {
    expect(audiencePageFromUrl(`${HOST}/for/enterprise`)?.kind).toBe("persona");
    expect(audiencePageFromUrl(`${HOST}/industries/fintech`)?.kind).toBe("industry");
    expect(audiencePageFromUrl(`${HOST}/industry/logistics`)?.kind).toBe("industry");
    expect(audiencePageFromUrl(`${HOST}/use-cases/onboarding`)?.kind).toBe("use_case");
    expect(audiencePageFromUrl(`${HOST}/usecases/onboarding`)?.kind).toBe("use_case");
  });

  test("FR sections map to the same three", () => {
    expect(audiencePageFromUrl(`${HOST}/pour/agences`)?.kind).toBe("persona");
    expect(audiencePageFromUrl(`${HOST}/secteurs/assurance`)?.kind).toBe("industry");
    expect(audiencePageFromUrl(`${HOST}/cas-d-usage/facturation`)?.kind).toBe("use_case");
  });

  test("DE sections map to the same three", () => {
    expect(audiencePageFromUrl(`${HOST}/branchen/versicherung`)?.kind).toBe("industry");
    expect(audiencePageFromUrl(`${HOST}/loesungen/abrechnung`)?.kind).toBe("use_case");
  });

  test("/solutions is a USE CASE — the assumed call, held by a test", () => {
    // Stated in the module: solutions pages are named after a job to be done far
    // more often than after a buyer. A page in the wrong one of three known buckets
    // is the failure we accept; a page in a bucket nobody defined is not.
    expect(audiencePageFromUrl(`${HOST}/solutions/incident-response`)?.kind).toBe("use_case");
    expect(audiencePageFromUrl(`${HOST}/solution/expense-management`)?.kind).toBe("use_case");
  });

  test("a section we do not know produces nothing", () => {
    expect(audiencePageFromUrl(`${HOST}/roles/analyst`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/verticals/retail`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/blog/for-enterprise-teams`)).toBeNull();
  });
});

describe("one level of depth", () => {
  test("a sub-page is the PARENT segment, never a second one", () => {
    const hit = audiencePageFromUrl(`${HOST}/solutions/finance/banking`);
    expect(hit?.slug).toBe("finance");
  });

  test("a locale prefix does not hide the section", () => {
    expect(audiencePageFromUrl(`${HOST}/en/industries/fintech`)?.slug).toBe("fintech");
  });

  test("the section ROOT names nobody", () => {
    expect(audiencePageFromUrl(`${HOST}/industries`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/solutions`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/for/`)).toBeNull();
  });
});

describe("the stoplist and the guards", () => {
  test("chrome slugs never enter the registry", () => {
    expect(audiencePageFromUrl(`${HOST}/for/index`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/solutions/overview`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/industries/all`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/use-cases/pricing`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/for/contact`)).toBeNull();
  });

  test("a file, a number, or a sentence is not a segment", () => {
    expect(audiencePageFromUrl(`${HOST}/industries/fintech.html`)).toBeNull();
    expect(audiencePageFromUrl(`${HOST}/use-cases/12`)).toBeNull();
    expect(
      audiencePageFromUrl(`${HOST}/solutions/how-to-cut-your-onboarding-time-in-half-today`),
    ).toBeNull();
  });

  test("underscores and hyphens are one page", () => {
    expect(audiencePageFromUrl(`${HOST}/for/field_service`)?.slug).toBe("field-service");
    expect(audiencePageFromUrl(`${HOST}/for/field-service`)?.slug).toBe("field-service");
  });

  test("the display name is prettified", () => {
    expect(audiencePageFromUrl(`${HOST}/for/field-service`)?.displayName).toBe("Field Service");
    // Words of two letters or less are upper-cased: "HR Teams", not "Hr Teams".
    expect(audiencePageFromUrl(`${HOST}/for/hr-teams`)?.displayName).toBe("HR Teams");
  });
});

describe("industries answer to the catalog", () => {
  test("a sitemap slug and a case study label land on the SAME canonical slug", () => {
    // The whole point of "declared vs proven": without one vocabulary the
    // intersection compares two independent spellings and is always empty.
    const declared = audiencePageFromUrl(`${HOST}/industries/fin-tech`);
    const proven = resolveIndustry("Fintech");
    expect(declared?.slug).toBe(proven.slug);
    expect(declared?.slug).toBe("fintech");
    expect(declared?.isCanonical).toBe(true);
  });

  test("a French and a German industry page reach the same slug as an English one", () => {
    expect(audiencePageFromUrl(`${HOST}/secteurs/assurance`)?.slug).toBe("insurance");
    expect(audiencePageFromUrl(`${HOST}/branchen/versicherung`)?.slug).toBe("insurance");
    expect(audiencePageFromUrl(`${HOST}/industries/insurance`)?.slug).toBe("insurance");
  });

  test("a vertical the catalog does not know is stored, not guessed", () => {
    const hit = audiencePageFromUrl(`${HOST}/industries/quantum-computing`);
    // Same slugifier `case_studies` uses for an unknown label, so the two sides
    // still meet if the catalog never learns the word.
    expect(hit?.slug).toBe("quantum_computing");
    expect(hit?.slug).toBe(resolveIndustry("Quantum Computing").slug);
    expect(hit?.isCanonical).toBe(false);
  });

  test("persona and use_case keep their URL slug — there is nothing to compare to", () => {
    expect(audiencePageFromUrl(`${HOST}/for/fintech`)?.slug).toBe("fintech");
    expect(audiencePageFromUrl(`${HOST}/for/fintech`)?.isCanonical).toBe(false);
  });
});

describe("a set of URLs", () => {
  test("dedupes on (kind, slug), and keeps one slug under two kinds", () => {
    const hits = audiencePagesFromUrls([
      `${HOST}/industries/fintech`,
      `${HOST}/en/industries/fintech`,
      `${HOST}/solutions/fintech`,
      `${HOST}/pricing`,
    ]);
    expect(hits.map((h) => `${h.kind}:${h.slug}`)).toEqual([
      "industry:fintech",
      "use_case:fintech",
    ]);
    // The first URL wins — it is the evidence we can prove.
    expect(hits[0]!.evidenceUrl).toBe(`${HOST}/industries/fintech`);
  });

  test("isAudienceUrl is the routing test, and it agrees with the reader", () => {
    expect(isAudienceUrl(`${HOST}/industries/fintech`)).toBe(true);
    expect(isAudienceUrl(`${HOST}/industries`)).toBe(false);
    expect(isAudienceUrl(`${HOST}/vs/klue`)).toBe(false);
    expect(isAudienceUrl(`${HOST}/customers/acme`)).toBe(false);
  });
});

describe("the audience hub", () => {
  const hub = (hrefs: string[]) =>
    `<!doctype html><html><body><h1>Solutions</h1>
      ${hrefs.map((h) => `<a href="${h}">go</a>`).join("")}</body></html>`;

  test("only LINKS are read, never the prose", () => {
    const html = `<!doctype html><html><body>
      <p>Trusted by Fintech, Healthcare and Logistics leaders everywhere.</p>
      <a href="/industries/fintech">Fintech</a>
      <a href="/use-cases/onboarding">Onboarding</a>
    </body></html>`;
    const hits = parseAudienceIndex(html, `${HOST}/solutions`);
    expect(hits.map((h) => h.slug).sort()).toEqual(["fintech", "onboarding"]);
  });

  test("off-host links are ignored", () => {
    const hits = parseAudienceIndex(
      hub(["https://elsewhere.com/industries/fintech", "/industries/retail"]),
      `${HOST}/solutions`,
    );
    expect(hits.map((h) => h.slug)).toEqual(["retail"]);
  });

  test("one link is a nav entry, not a hub", () => {
    expect(looksLikeAudienceIndex(hub(["/industries/fintech"]), `${HOST}/solutions`)).toBe(false);
    expect(
      looksLikeAudienceIndex(hub(["/industries/fintech", "/for/agencies"]), `${HOST}/solutions`),
    ).toBe(true);
  });
});

describe("the run plan", () => {
  test("no marker means baseline, a marker means read", () => {
    expect(planAudienceRun({ baselinedAt: null }).mode).toBe("baseline");
    expect(planAudienceRun({ baselinedAt: new Date() }).mode).toBe("read");
  });
});
