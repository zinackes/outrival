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
  it("counts customer logos and testimonials", () => {
    expect(s.socialProof.customerLogos.length).toBe(4);
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
});
