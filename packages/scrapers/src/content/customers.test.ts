import { test, expect, describe } from "bun:test";
import {
  applyCaseStudyGuards,
  findCaseStudyLinks,
  isCustomerIndexUrl,
  isCustomerPageUrl,
  parseCustomerLogos,
  planCustomersRun,
} from "./customers";

// A real-shaped customers index: a logo wall with a mix of genuine brands and the
// junk every wall carries (a nav mark, an award badge, a testimonial avatar, a
// design-tool export), plus links to the individual stories.
const CUSTOMERS_INDEX = `<!doctype html><html><head><title>Customers | Rival</title></head><body>
  <header><a href="/"><img alt="Rival" src="/logo.svg"></a></header>
  <main>
    <h1>Trusted by teams everywhere</h1>
    <div class="logo-wall">
      <img alt="Acme Logistics" src="https://cdn.rival.com/acme.svg">
      <img alt="Globex" src="https://cdn.rival.com/globex.png">
      <img alt="Initech GmbH" src="https://cdn.rival.com/initech.png">
      <img alt="Frame 616" src="https://cdn.rival.com/frame-616.png">
      <img alt="Rated 4.8/5 on Capterra" src="/badge.png">
      <img alt="https://cdn.rival.com/unnamed.png" src="/unnamed.png">
    </div>
    <ul class="stories">
      <li><a href="/customers/acme-logistics">How Acme cut sorting time</a></li>
      <li><a href="/case-studies/globex">Globex scales support</a></li>
      <li><a href="/customers">All customers</a></li>
      <li><a href="/pricing">Pricing</a></li>
      <li><a href="https://medium.com/@someone/customers/other">Off-site story</a></li>
    </ul>
  </main>
  <footer>
    <div class="testimonial"><img alt="Erin Luers Abbott" src="/avatar.png"></div>
    <img alt="Partner Award 2026" src="/footer-award.png">
  </footer>
</body></html>`;

describe("URL patterns", () => {
  test("recognises customer paths in EN / FR / DE / ES", () => {
    for (const url of [
      "https://rival.com/customers",
      "https://rival.com/customers/acme",
      "https://rival.com/case-studies/globex",
      "https://rival.com/success-stories/initech",
      "https://rival.com/clients",
      "https://rival.com/temoignages/acme",
      "https://rival.de/kunden/acme",
      "https://rival.de/referenzen",
      "https://rival.de/fallstudien/acme",
      "https://rival.es/clientes",
      "https://rival.es/casos-de-exito/acme",
    ]) {
      expect(isCustomerPageUrl(url)).toBe(true);
    }
    for (const url of ["https://rival.com/pricing", "https://rival.com/blog/customer-support"]) {
      expect(isCustomerPageUrl(url)).toBe(false);
    }
  });

  test("tells the index from one customer's story", () => {
    expect(isCustomerIndexUrl("https://rival.com/customers")).toBe(true);
    expect(isCustomerIndexUrl("https://rival.com/en/case-studies/")).toBe(true);
    expect(isCustomerIndexUrl("https://rival.com/customers/acme")).toBe(false);
    expect(isCustomerIndexUrl("https://rival.com/pricing")).toBe(false);
  });
});

describe("parseCustomerLogos", () => {
  test("reads brands off alt text and drops everything that is not one", () => {
    const names = parseCustomerLogos(CUSTOMERS_INDEX).map((h) => h.displayName);
    expect(names).toContain("Acme Logistics");
    expect(names).toContain("Globex");
    expect(names).toContain("Initech GmbH");
    // Design-tool export, award badge, CDN path, testimonial avatar, own header mark.
    expect(names).not.toContain("Frame 616");
    expect(names.some((n) => /capterra/i.test(n))).toBe(false);
    expect(names.some((n) => /^https?:/.test(n))).toBe(false);
    expect(names).not.toContain("Erin Luers Abbott");
    expect(names).not.toContain("Rival");
  });

  test("the registry key strips the legal form so one customer is one row", () => {
    const initech = parseCustomerLogos(CUSTOMERS_INDEX).find(
      (h) => h.displayName === "Initech GmbH",
    );
    expect(initech?.nameNormalized).toBe("initech");
  });
});

describe("findCaseStudyLinks", () => {
  test("follows same-host story links only, never the index or another domain", () => {
    const links = findCaseStudyLinks(CUSTOMERS_INDEX, "https://rival.com/customers");
    expect(links).toEqual([
      "https://rival.com/customers/acme-logistics",
      "https://rival.com/case-studies/globex",
    ]);
  });

  test("honours the cap", () => {
    expect(findCaseStudyLinks(CUSTOMERS_INDEX, "https://rival.com/customers", 1)).toHaveLength(1);
  });
});

describe("planCustomersRun", () => {
  // The rule that keeps a competitor's back catalogue from reading as fresh wins.
  test("a competitor we have never read is a baseline", () => {
    expect(planCustomersRun({ heldRows: 0 })).toEqual({ mode: "baseline" });
    expect(planCustomersRun({ heldRows: 1 })).toEqual({ mode: "read" });
  });
});

describe("applyCaseStudyGuards", () => {
  const FR_PAGE = `Étude de cas — Banque Michel
  Banque Michel, banque régionale de 400 agences, a déployé Rival en 2025.
  Résultat : nous avons réduit le churn de 32% en six mois et divisé par deux le
  temps de traitement des dossiers.`;

  test("a French story keeps its verbatim metrics and resolves its market", () => {
    const guarded = applyCaseStudyGuards(FR_PAGE, {
      customerName: "Banque Michel",
      customerIndustryLabel: "banque régionale",
      useCase: "Churn reduction across branches",
      metricsClaimed: ["réduit le churn de 32%", "divisé par deux le temps de traitement"],
    });
    expect(guarded.customerName).toBe("Banque Michel");
    expect(guarded.industrySlug).toBe("fintech");
    expect(guarded.isCanonicalIndustry).toBe(true);
    expect(guarded.metricsClaimed).toEqual([
      "réduit le churn de 32%",
      "divisé par deux le temps de traitement",
    ]);
  });

  test("a metric the page does not write is dropped, not stored", () => {
    const guarded = applyCaseStudyGuards(FR_PAGE, {
      customerName: "Banque Michel",
      customerIndustryLabel: "banque",
      useCase: null,
      // The second one is a plausible invention: nothing in the page says it.
      metricsClaimed: ["réduit le churn de 32%", "increased revenue by 3x year over year"],
    });
    expect(guarded.metricsClaimed).toEqual(["réduit le churn de 32%"]);
  });

  test("an anonymised story yields no customer name", () => {
    const page = `Case study: how a leading European bank cut onboarding time by 40%
      after rolling out Rival across its retail division.`;
    const guarded = applyCaseStudyGuards(page, {
      // The model turned the description into a name. The page never writes it.
      customerName: "European Bank",
      customerIndustryLabel: "banking",
      useCase: "Onboarding",
      metricsClaimed: ["cut onboarding time by 40%"],
    });
    expect(guarded.customerName).toBe(null);
    // The story still counts for the vertical, and its metric is still verbatim.
    expect(guarded.industrySlug).toBe("fintech");
    expect(guarded.metricsClaimed).toEqual(["cut onboarding time by 40%"]);
  });

  test("a name is matched at word boundaries, so Ramp is not Rampart", () => {
    const page = "Rampart Security has used the platform since 2024.";
    expect(
      applyCaseStudyGuards(page, { customerName: "Ramp", metricsClaimed: [] }).customerName,
    ).toBe(null);
    expect(
      applyCaseStudyGuards("Ramp has used the platform since 2024.", {
        customerName: "Ramp",
        metricsClaimed: [],
      }).customerName,
    ).toBe("Ramp");
  });

  test("an unknown market is kept but can never raise severity", () => {
    const guarded = applyCaseStudyGuards("Acme runs particle simulations.", {
      customerName: "Acme",
      customerIndustryLabel: "particle physics lab",
      metricsClaimed: [],
    });
    expect(guarded.industrySlug).toBe("particle_physics_lab");
    expect(guarded.isCanonicalIndustry).toBe(false);
    expect(guarded.industryLabel).toBe("particle physics lab");
  });

  test("no market stated is null, not a guess", () => {
    const guarded = applyCaseStudyGuards("Acme uses the product.", {
      customerName: "Acme",
      customerIndustryLabel: null,
      metricsClaimed: [],
    });
    expect(guarded.industrySlug).toBe(null);
    expect(guarded.isCanonicalIndustry).toBe(false);
  });
});
