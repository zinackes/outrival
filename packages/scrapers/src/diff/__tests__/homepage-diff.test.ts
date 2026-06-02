import { describe, expect, it } from "bun:test";
import { parseHomepageStructure } from "../../parsers/homepage-structure";
import { diffHomepages } from "../homepage-diff";

const BASE = "https://acme.com/";

// A compact but realistic homepage, used as the "before". Each test mutates one
// thing and asserts the structural diff isolates exactly that.
const BEFORE = `<!doctype html><html><head>
  <title>Acme — Ship faster</title>
  <meta name="description" content="Acme helps teams ship.">
</head><body>
  <header><nav>
    <a href="/features">Features</a>
    <a href="/pricing">Pricing</a>
  </nav></header>
  <main>
    <section class="hero">
      <h1>Ship faster with Acme</h1>
      <p>The all-in-one platform for product teams.</p>
      <a class="btn-primary" href="/signup">Get started</a>
    </section>
    <section>
      <h2>Features</h2>
      <p>Powerful automation and analytics for your team.</p>
    </section>
    <section>
      <h2>What our customers say</h2>
      <blockquote>Acme changed how we work. — Jane</blockquote>
      <blockquote>Best tool ever. — John</blockquote>
    </section>
  </main>
</body></html>`;

const parse = (html: string) => parseHomepageStructure(html, BASE);

describe("diffHomepages — no change", () => {
  it("identical structures produce no changes", () => {
    expect(diffHomepages(parse(BEFORE), parse(BEFORE))).toEqual([]);
  });

  it("a rotating testimonial carousel produces no structural change", () => {
    // Only WHICH quote is in the DOM changes; the count is identical.
    const after = BEFORE.replace(
      "Acme changed how we work. — Jane",
      "Couldn't live without it. — Mary",
    );
    expect(diffHomepages(parse(BEFORE), parse(after))).toEqual([]);
  });
});

describe("diffHomepages — real signals", () => {
  it("a changed H1 produces hero_headline_changed", () => {
    const after = BEFORE.replace(
      "Ship faster with Acme",
      "AI-powered project intelligence",
    );
    const changes = diffHomepages(parse(BEFORE), parse(after));
    const hero = changes.find((c) => c.kind === "hero_headline_changed");
    expect(hero).toBeDefined();
    expect(hero?.field).toBe("hero.headline");
    expect(hero?.before).toBe("Ship faster with Acme");
    expect(hero?.after).toBe("AI-powered project intelligence");
  });

  it("a new Pricing section produces section_added with field sections[pricing]", () => {
    const after = BEFORE.replace(
      "</main>",
      `<section><h2>Pricing</h2><p>Free, Pro $19/mo, Business $49/mo.</p></section></main>`,
    );
    const changes = diffHomepages(parse(BEFORE), parse(after));
    const added = changes.find((c) => c.kind === "section_added");
    expect(added).toBeDefined();
    expect(added?.field).toBe("sections[pricing]");
    expect(added?.after).toBe("Pricing");
  });
});

describe("diffHomepages — reordering only", () => {
  it("a pure section reorder yields only section_reordered", () => {
    // Swap the Features and Testimonials sections, no content change.
    const after = `<!doctype html><html><head>
      <title>Acme — Ship faster</title>
      <meta name="description" content="Acme helps teams ship.">
    </head><body>
      <header><nav>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
      </nav></header>
      <main>
        <section class="hero">
          <h1>Ship faster with Acme</h1>
          <p>The all-in-one platform for product teams.</p>
          <a class="btn-primary" href="/signup">Get started</a>
        </section>
        <section>
          <h2>What our customers say</h2>
          <blockquote>Acme changed how we work. — Jane</blockquote>
          <blockquote>Best tool ever. — John</blockquote>
        </section>
        <section>
          <h2>Features</h2>
          <p>Powerful automation and analytics for your team.</p>
        </section>
      </main>
    </body></html>`;
    const changes = diffHomepages(parse(BEFORE), parse(after));
    expect(changes.map((c) => c.kind)).toEqual(["section_reordered"]);
  });
});

describe("diffHomepages — section rename and body change", () => {
  it("a renamed section is paired, not removed+added", () => {
    const after = BEFORE.replace("<h2>Features</h2>", "<h2>Capabilities</h2>");
    const changes = diffHomepages(parse(BEFORE), parse(after));
    const renamed = changes.find((c) => c.kind === "section_renamed");
    expect(renamed?.before).toBe("Features");
    expect(renamed?.after).toBe("Capabilities");
    expect(changes.some((c) => c.kind === "section_removed")).toBe(false);
    expect(changes.some((c) => c.kind === "section_added")).toBe(false);
  });

  it("a substantially changed section body produces section_body_changed", () => {
    const after = BEFORE.replace(
      "Powerful automation and analytics for your team.",
      "Now with AI agents, workflow builder, and real-time dashboards.",
    );
    const changes = diffHomepages(parse(BEFORE), parse(after));
    const body = changes.find((c) => c.kind === "section_body_changed");
    expect(body).toBeDefined();
    expect(body?.bodyDiff?.added.length).toBeGreaterThan(0);
  });
});

describe("diffHomepages — navigation", () => {
  it("a new nav item produces navigation_changed", () => {
    const after = BEFORE.replace(
      `<a href="/pricing">Pricing</a>`,
      `<a href="/pricing">Pricing</a><a href="/enterprise">Enterprise</a>`,
    );
    const changes = diffHomepages(parse(BEFORE), parse(after));
    const nav = changes.find((c) => c.kind === "navigation_changed");
    expect(nav).toBeDefined();
    expect(nav?.after).toContain("Enterprise");
  });
});
