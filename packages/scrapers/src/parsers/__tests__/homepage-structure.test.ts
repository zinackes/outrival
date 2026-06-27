import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "bun:test";
import { parseHomepageStructure } from "../homepage-structure";

const BASE = "https://acme.com/";

const HOMEPAGE = `<!doctype html><html><head>
  <title>Acme — Ship faster</title>
  <meta name="description" content="Acme helps teams ship.">
  <link rel="canonical" href="https://acme.com/">
  <meta property="og:title" content="Acme OG">
  <meta property="og:description" content="OG desc">
  <meta property="og:image" content="https://acme.com/og.png">
  <meta property="og:type" content="website">
</head><body>
  <header><nav>
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
    <a href="/login">Log in</a>
  </nav></header>
  <main>
    <section class="hero">
      <h1>Ship faster with Acme</h1>
      <p>The all-in-one platform for product teams.</p>
      <a class="btn-primary" href="/signup">Get started</a>
      <a href="/demo">Book a demo</a>
    </section>

    <section>
      <h2>Features</h2>
      <p>Powerful automation and analytics for your team.</p>
      <a href="/features/automation">Learn more</a>
    </section>

    <section>
      <h2>Trusted by leading teams</h2>
      <div class="logos">
        <img src="/l1.svg" alt="Globex">
        <img src="/l2.svg" alt="Initech">
        <img src="/l3.svg" alt="Umbrella">
        <img src="/l4.svg" alt="Soylent">
      </div>
    </section>

    <section>
      <h2>What our customers say</h2>
      <blockquote>Acme changed how we work. — Jane</blockquote>
      <blockquote>Best tool ever. — John</blockquote>
    </section>

    <section>
      <h2>Pricing</h2>
      <p>Free, Pro $19/mo, Business $49/mo.</p>
    </section>

    <section>
      <h2>FAQ</h2>
      <details><summary>Is there a free plan?</summary><p>Yes.</p></details>
      <details><summary>Can I cancel?</summary><p>Anytime.</p></details>
    </section>
  </main>
  <footer>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
    <p>© 2026 Acme Inc.</p>
  </footer>
</body></html>`;

describe("parseHomepageStructure — metadata", () => {
  const s = parseHomepageStructure(HOMEPAGE, BASE);
  it("extracts title, description, canonical", () => {
    expect(s.title).toBe("Acme — Ship faster");
    expect(s.metaDescription).toBe("Acme helps teams ship.");
    expect(s.canonical).toBe("https://acme.com/");
  });
  it("extracts open graph", () => {
    expect(s.openGraph.title).toBe("Acme OG");
    expect(s.openGraph.image).toBe("https://acme.com/og.png");
    expect(s.openGraph.type).toBe("website");
  });
  it("reads the primary language subtag from <html lang>", () => {
    expect(parseHomepageStructure(`<html lang="fr-FR"><title>x</title></html>`, BASE).language).toBe(
      "fr",
    );
    expect(parseHomepageStructure(`<html lang="en"><title>x</title></html>`, BASE).language).toBe(
      "en",
    );
    expect(parseHomepageStructure(`<html><title>x</title></html>`, BASE).language).toBeNull();
  });
});

describe("parseHomepageStructure — hero", () => {
  const s = parseHomepageStructure(HOMEPAGE, BASE);
  it("extracts the H1 and subheadline", () => {
    expect(s.hero.headline).toBe("Ship faster with Acme");
    expect(s.hero.subheadline).toBe("The all-in-one platform for product teams.");
  });
  it("extracts primary and secondary CTAs with resolved hrefs", () => {
    expect(s.hero.primaryCta).toEqual({ text: "Get started", href: "https://acme.com/signup" });
    expect(s.hero.secondaryCta?.text).toBe("Book a demo");
  });
});

// Browser-rendered text: <br> and inline-styled fragments must not glue into
// one word ("Gérer<br>une" → "Gérer une", not "Gérerune"), while a styled
// substring of a single word ("Out<span>rival</span>") must stay glued.
describe("parseHomepageStructure — break-aware text extraction", () => {
  const html = (hero: string) =>
    `<!doctype html><html><head><title>T</title></head><body><section class="hero">${hero}</section>
     <section><h2>What our customers say</h2>
       <blockquote><p>Gérer<br>une ESN sur Excel a ses limites, vraiment beaucoup de limites.</p></blockquote>
     </section></body></html>`;

  it("inserts a space across <br> in the headline", () => {
    const s = parseHomepageStructure(html("<h1>Gérer<br>une ESN sur Excel</h1>"), BASE);
    expect(s.hero.headline).toBe("Gérer une ESN sur Excel");
  });
  it("inserts a space across a block-level child in the headline", () => {
    const s = parseHomepageStructure(
      html('<h1><div class="a">Gérer</div><div class="b">une ESN</div></h1>'),
      BASE,
    );
    expect(s.hero.headline).toBe("Gérer une ESN");
  });
  it("keeps an inline-styled fragment of a single word glued", () => {
    const s = parseHomepageStructure(html('<h1>Out<span class="x">rival</span></h1>'), BASE);
    expect(s.hero.headline).toBe("Outrival");
  });
  it("inserts a space across <br> in testimonial quotes", () => {
    const s = parseHomepageStructure(html("<h1>Hi</h1>"), BASE);
    expect(s.socialProof.testimonials[0]?.quote).toContain("Gérer une ESN sur Excel");
    expect(s.socialProof.testimonials[0]?.quote).not.toContain("Gérerune");
  });
});

describe("parseHomepageStructure — sections", () => {
  const s = parseHomepageStructure(HOMEPAGE, BASE);
  const typeOf = (heading: string) => s.sections.find((x) => x.heading === heading)?.type;

  it("splits into one section per H2", () => {
    expect(s.sections.map((x) => x.heading)).toEqual([
      "Features",
      "Trusted by leading teams",
      "What our customers say",
      "Pricing",
      "FAQ",
    ]);
  });
  it("classifies section types heuristically", () => {
    expect(typeOf("Features")).toBe("features");
    expect(typeOf("Trusted by leading teams")).toBe("logos");
    expect(typeOf("What our customers say")).toBe("testimonials");
    expect(typeOf("Pricing")).toBe("pricing");
    expect(typeOf("FAQ")).toBe("faq");
  });
  it("does not leak hero/nav/footer text into sections", () => {
    const features = s.sections.find((x) => x.heading === "Features");
    expect(features?.bodyText).toContain("automation and analytics");
    expect(features?.bodyText).not.toContain("Ship faster");
  });
});

describe("parseHomepageStructure — navigation, footer, social proof", () => {
  const s = parseHomepageStructure(HOMEPAGE, BASE);
  it("captures nav items with hrefs", () => {
    expect(s.navigation.items.map((i) => i.text)).toEqual(["Features", "Pricing", "Log in"]);
    expect(s.navigation.items[1]?.href).toBe("https://acme.com/pricing");
  });
  it("captures footer links and normalises the copyright year", () => {
    expect(s.footer.links.map((i) => i.text)).toEqual(["Privacy", "Terms"]);
    expect(s.footer.text).toContain("«year»");
    expect(s.footer.text).not.toContain("2026");
  });
  it("captures customer logos with brand name and resolved absolute src", () => {
    expect(s.socialProof.customerLogos.length).toBe(4);
    expect(s.socialProof.customerLogos[0]).toEqual({
      name: "Globex",
      src: "https://acme.com/l1.svg",
    });
    expect(s.socialProof.testimonialCount).toBeGreaterThanOrEqual(2);
  });
});

// A rotating carousel changes which testimonial is in the DOM, but the count
// stays put — the structure must be identical so the diff (step 4) emits nothing.
describe("parseHomepageStructure — carousel rotation is invisible", () => {
  const a = parseHomepageStructure(
    HOMEPAGE.replace("Acme changed how we work. — Jane", "Totally recommend it. — Mary"),
    BASE,
  );
  const b = parseHomepageStructure(HOMEPAGE, BASE);
  it("yields the same testimonial count regardless of which quote shows", () => {
    expect(a.socialProof.testimonialCount).toBe(b.socialProof.testimonialCount);
  });
});

// Real captured pages (reused from the pricing fixtures): the parser must not
// throw on messy production HTML and must always return a title + some sections.
describe("parseHomepageStructure — real fixtures don't throw", () => {
  const FIXTURES = join(import.meta.dir, "..", "..", "pricing", "__fixtures__");
  test.each(["linear", "notion", "crayon", "segment"])("%s parses", (name) => {
    const html = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
    const s = parseHomepageStructure(html, `https://${name}.com`);
    expect(typeof s.title).toBe("string");
    expect(Array.isArray(s.sections)).toBe(true);
  });

  it("seeds identity from JSON-LD when OpenGraph tags are absent (patch-30)", () => {
    const html = `<!doctype html><html><head>
      <title>Acme</title>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Organization",
        name: "Acme Inc",
        description: "Acme helps teams ship faster.",
      })}</script>
    </head><body><h1>Hi</h1></body></html>`;
    const s = parseHomepageStructure(html, BASE);
    expect(s.openGraph.title).toBe("Acme Inc");
    expect(s.openGraph.description).toBe("Acme helps teams ship faster.");
  });

  it("does not override present OpenGraph tags with JSON-LD", () => {
    const s = parseHomepageStructure(HOMEPAGE, BASE);
    expect(s.openGraph.title).toBe("Acme OG");
    expect(s.openGraph.description).toBe("OG desc");
  });
});
