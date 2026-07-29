import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "bun:test";
import { parseHomepageStructure, isIncompleteRender } from "../homepage-structure";

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
  it("falls back to the <html lang> subtag when there's too little copy to detect", () => {
    expect(parseHomepageStructure(`<html lang="fr-FR"><title>x</title></html>`, BASE).language).toBe(
      "fr",
    );
    expect(parseHomepageStructure(`<html lang="en"><title>x</title></html>`, BASE).language).toBe(
      "en",
    );
    expect(parseHomepageStructure(`<html><title>x</title></html>`, BASE).language).toBeNull();
  });
  it("detects the real language from the copy, overriding a wrong <html lang>", () => {
    // The bug: a stale boilerplate lang="fr" on plainly-English copy flagged the
    // page as foreign and offered a bogus "Translate to English".
    const englishUnderFrLang = `<html lang="fr"><head><title>Acme — sales platform</title>
      <meta name="description" content="Transforming how businesses connect, serve and grow."></head>
      <body><main><h1>Transforming how businesses Connect, Serve & Grow.</h1>
      <p>Our platform helps teams automate outreach, close deals faster, and grow revenue.
      Trusted by thousands of companies worldwide. Start your free trial today.</p></main></body></html>`;
    expect(parseHomepageStructure(englishUnderFrLang, BASE).language).toBe("en");
  });
  it("detects a genuinely foreign page even without a lang attribute", () => {
    const frenchNoLang = `<html><head><title>Acme — plateforme commerciale</title></head>
      <body><main><h1>Transformez la façon dont les entreprises se connectent et grandissent.</h1>
      <p>Notre plateforme aide les équipes à automatiser leurs campagnes et à conclure des ventes
      plus rapidement. Des milliers d'entreprises nous font déjà confiance.</p></main></body></html>`;
    expect(parseHomepageStructure(frenchNoLang, BASE).language).toBe("fr");
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

// The buttons of a hero are very often NOT inside the element that wraps the H1: a
// text column holds the copy and a sibling holds the actions. Looking only at the
// H1's nearest section/div therefore returned no CTA at all, which is what left 73
// of 181 production captures with a headline and nothing to say about how the
// competitor sells.
describe("parseHomepageStructure — hero CTA scope", () => {
  const page = (hero: string) =>
    `<!doctype html><html><head><title>T</title></head><body>
      <header><nav>
        <a href="/product">Product</a><a href="/pricing">Pricing</a><a href="/login">Log in</a>
      </nav></header>
      <main>${hero}</main>
      <footer><a href="/terms">Terms</a></footer>
     </body></html>`;

  it("finds the buttons in a SIBLING of the column that holds the H1", () => {
    const s = parseHomepageStructure(
      page(`<section class="hero">
              <div class="max-w-xl"><h1>Ship faster</h1><p>For product teams.</p></div>
              <div class="actions">
                <a class="btn-primary" href="/signup">Start free</a>
                <a href="/demo">Book a demo</a>
              </div>
            </section>`),
      BASE,
    );
    expect(s.hero.primaryCta).toEqual({ text: "Start free", href: "https://acme.com/signup" });
    expect(s.hero.secondaryCta?.text).toBe("Book a demo");
  });

  it("climbs through several wrappers between the H1 and the buttons", () => {
    const s = parseHomepageStructure(
      page(`<section><div><div><div class="copy"><h1>Ship faster</h1></div></div>
              <a class="cta" href="/signup">Get started</a></div></section>`),
      BASE,
    );
    expect(s.hero.primaryCta?.text).toBe("Get started");
  });

  it("never treats a navigation or footer link as a hero CTA", () => {
    // The H1 sits alone in <main>, so the walk reaches an ancestor that also contains
    // the nav. Before the nav exclusion, this hero's "primary CTA" was "Product".
    const s = parseHomepageStructure(page(`<h1>Ship faster</h1>`), BASE);
    expect(s.hero.primaryCta).toBeNull();
    expect(s.hero.secondaryCta).toBeNull();
  });

  it("reads a button whose label spans several blocks without gluing it", () => {
    // Verbatim shapes from production: "Newv4.5.0 GAv4.5.0: AI Agents are GA" and
    // "Get StartedBring NextGen to My Campus" were stored as the primary CTA.
    const s = parseHomepageStructure(
      page(`<section><h1>Ship faster</h1>
              <a href="/signup"><div>Get Started</div><div>Bring NextGen to My Campus</div></a>
            </section>`),
      BASE,
    );
    expect(s.hero.primaryCta?.text).toBe("Get Started Bring NextGen to My Campus");
  });

  it("does not mistake an off-site eyebrow badge for the call to action", () => {
    // Heroes open with a funding badge, a review score or a release note, all of them
    // pointing off-site, and all of them were being read as the primary CTA purely for
    // coming first. One rule removes the class without naming any of them.
    const s = parseHomepageStructure(
      page(`<section>
              <a href="https://www.ycombinator.com/companies/acme">Backed by Y Combinator</a>
              <a href="https://www.g2.com/products/acme">4.6/5 on G2</a>
              <h1>Ship faster</h1>
              <a href="/signup">Start your project</a>
            </section>`),
      BASE,
    );
    expect(s.hero.primaryCta?.text).toBe("Start your project");
  });

  it("keeps a link to their own app subdomain", () => {
    // "Open the app" points at app.acme.com, which is the same site, not off it.
    const s = parseHomepageStructure(
      page(`<section><h1>Ship faster</h1>
              <a href="https://app.acme.com/new">Start building</a></section>`),
      BASE,
    );
    expect(s.hero.primaryCta).toEqual({
      text: "Start building",
      href: "https://app.acme.com/new",
    });
  });

  it("ranks the button by its label, not by document order", () => {
    // supabase.com: "Start your project" carries no telltale class, so before the label
    // was consulted it lost to whichever link the hero happened to render first.
    const s = parseHomepageStructure(
      page(`<section><h1>Build in a weekend</h1>
              <a href="/docs">Documentation</a>
              <a href="/dashboard">Start your project</a></section>`),
      BASE,
    );
    expect(s.hero.primaryCta?.text).toBe("Start your project");
  });

  it("ignores the skip link, which is deliberately the first focusable element", () => {
    const s = parseHomepageStructure(
      page(`<section><a href="#main">Skip to content</a><h1>Ship faster</h1>
              <a class="btn-primary" href="/signup">Start free</a></section>`),
      BASE,
    );
    expect(s.hero.primaryCta?.text).toBe("Start free");
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
  it("inserts a space across inline spans made block via CSS (Supabase hero)", () => {
    // Two inline <span> stacked as separate lines by `display:block` — cheerio
    // has no layout so this relied on the class/style intent, not the tag.
    const viaClass = parseHomepageStructure(
      html('<h1><span class="block">Build in a weekend</span><span class="block">Scale to millions</span></h1>'),
      BASE,
    );
    expect(viaClass.hero.headline).toBe("Build in a weekend Scale to millions");
    const viaStyle = parseHomepageStructure(
      html('<h1><span style="display:block">Build in a weekend</span><span style="display: block">Scale to millions</span></h1>'),
      BASE,
    );
    expect(viaStyle.hero.headline).toBe("Build in a weekend Scale to millions");
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

// The broad quote selector (`[class*="testimonial"]`, `[class*="quote"]`) matches a
// testimonial CARD and its inner `.testimonial-text` / `.testimonial-author` parts.
// Regression: the proof list came out as bare names/roles ("Managing Director @ …")
// with the actual reviews missing (real-world SlideLizard markup).
describe("parseHomepageStructure — testimonials with class-tagged inner parts", () => {
  const HTML = `<!doctype html><html><head><title>T</title></head><body>
    <section>
      <h2>What our customers say</h2>
      <div class="testimonial">
        <p class="testimonial-text">With the help of SlideLizard, we conducted our management conference completely online for the first time. The participants were excited!</p>
        <p class="testimonial-author">Head of Marketing/Communications @ DB Schenker Austria</p>
      </div>
      <div class="testimonial">
        <p class="testimonial-text">The tool made our hybrid event effortless and our attendees loved every session of it.</p>
        <p class="testimonial-author">Managing Director @ Reichl und Partner (Ad Agency)</p>
      </div>
    </section>
  </body></html>`;
  const s = parseHomepageStructure(HTML, BASE);
  const quotes = s.socialProof.testimonials.map((t) => t.quote);

  it("captures the actual review text, not the person's role", () => {
    expect(quotes.some((q) => q.startsWith("With the help of SlideLizard"))).toBe(true);
    expect(quotes.some((q) => q.includes("hybrid event effortless"))).toBe(true);
  });
  it("never surfaces an attribution line as a quote", () => {
    expect(quotes.some((q) => q.includes("Managing Director"))).toBe(false);
    expect(quotes.some((q) => q.includes("Head of Marketing"))).toBe(false);
  });
  it("captures every card (does not collapse the wall to one)", () => {
    expect(s.socialProof.testimonials.length).toBe(2);
  });
  it("links the role to its quote as the author", () => {
    const first = s.socialProof.testimonials.find((t) =>
      t.quote.startsWith("With the help of SlideLizard"),
    );
    expect(first?.author).toContain("DB Schenker Austria");
  });
});

// The broad social-proof selector also matches the site's own header/footer brand
// mark and tracking pixels — they must never flood the customer wall.
describe("parseHomepageStructure — own logo and pixels excluded from the wall", () => {
  const HTML = `<!doctype html><html><head><title>Acme</title></head><body>
    <header><a href="/" class="navbar-brand"><img src="/logo.svg" alt="Acme"></a></header>
    <main>
      <section><h2>Trusted by</h2><div class="logos">
        <img src="/customers/globex.svg" alt="Globex">
        <img src="/customers/initech.svg" alt="Initech">
        <img src="https://px.example.com/p.gif" alt="" width="1" height="1">
      </div></section>
    </main>
    <footer class="footer"><img src="/logo-white.svg" alt="Acme"></footer>
  </body></html>`;
  const s = parseHomepageStructure(HTML, "https://acme.com/");
  it("keeps only the two real customer logos", () => {
    const names = s.socialProof.customerLogos.map((l) => l.name);
    expect(names).toEqual(["Globex", "Initech"]);
  });
});

// Modern homepages ship customer logos as inline monochrome <svg> wordmarks in
// utility-class containers (no "logo"/"customer" class) — the brand signal is an
// aria-label on the list and on each svg. Both must be captured (Supabase pattern).
describe("parseHomepageStructure — inline SVG logos in aria-labelled containers", () => {
  const svg = (label: string, extra = "") =>
    `<svg role="img" aria-label="${label}" ${extra} viewBox="0 0 60 20"><path d="M0 0h60v20H0z"></path></svg>`;
  const HTML = `<!doctype html><html><head><title>Acme</title></head><body>
    <header><a href="/">${svg("Acme")}</a></header>
    <main>
      <p>Trusted by fast-growing companies worldwide</p>
      <ul aria-label="Trusted by fast-growing companies worldwide" class="grid grid-cols-6">
        <li class="flex">${svg("Betashares")}</li>
        <li class="flex">${svg("Figma")}</li>
        <li class="flex">${svg("Loops")}</li>
        <li class="flex"><svg aria-hidden="true" viewBox="0 0 8 8"><path d="M0 0h8v8H0z"></path></svg></li>
      </ul>
    </main>
  </body></html>`;
  const s = parseHomepageStructure(HTML, "https://acme.com/");

  it("captures the brand svgs, skipping the decorative and own-brand marks", () => {
    expect(s.socialProof.customerLogos.map((l) => l.name)).toEqual([
      "Betashares",
      "Figma",
      "Loops",
    ]);
  });
  it("serializes each svg to a renderable data:image/svg+xml URI", () => {
    for (const l of s.socialProof.customerLogos) {
      expect(l.src).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });
  it("falls back to the name chip (src null) when the svg exceeds the size cap", () => {
    const big = svg("Humata", `data-x="${"p".repeat(6100)}"`);
    const html = `<!doctype html><html><head><title>x</title></head><body><main>
      <ul aria-label="Used by leading teams"><li>${big}</li></ul>
    </main></body></html>`;
    const one = parseHomepageStructure(html, "https://acme.com/").socialProof.customerLogos;
    expect(one).toEqual([{ name: "Humata", src: null }]);
  });
});

// The nhost.io regression: a "Trusted by" strip whose logos sit in a utility-class
// <div> that is a plain SIBLING of the heading (no logo/customer/trusted class, no
// aria-label), on a page whose design system names its accent COLOR "brand"
// (text-brand-*, bg-brand-*) — so the old [class*="brand"] selector swept up every
// accent-tinted feature card (decorative icons, screenshots) while missing the real
// wall entirely.
describe("parseHomepageStructure — heading-anchored strip + brand-color cards", () => {
  const HTML = `<!doctype html><html><head><title>Nhostish</title></head><body>
    <header><a href="/"><img src="/logo.svg" alt="Nhostish Logo"></a></header>
    <main>
      <section class="w-full pt-14">
        <div class="mx-auto max-w-7xl grid justify-center gap-12 text-center">
          <h2 class="text-base text-white">Trusted by developers at</h2>
          <div class="flex flex-row flex-wrap items-center justify-center gap-x-6">
            <img alt="Celsia Logo" src="/customers/celsia.svg">
            <img alt="React Flow Logo" src="/customers/react-flow.svg">
            <img alt="RevTron Logo" src="/customers/revtron.svg">
          </div>
        </div>
      </section>
      <section class="w-full mt-24">
        <h2 class="font-semibold">Build. Deploy. Scale.</h2>
        <div class="grid grid-cols-4">
          <div class="rounded-xl border border-divider text-brand-light hover:border-brand-main">
            <p>AI &amp; embeddings, ready to use.</p>
            <div class="flex h-24 items-center justify-center">
              <img alt="AI Services Icon" src="/products/openai-logo.svg" width="56" height="56">
            </div>
          </div>
          <div class="rounded-xl border border-divider text-brand-light">
            <img alt="Transparent lines" src="/common/line-grid.svg" width="1003" height="644">
          </div>
        </div>
      </section>
    </main>
  </body></html>`;
  const s = parseHomepageStructure(HTML, "https://nhostish.io/");
  it("captures the heading-anchored customer logos", () => {
    expect(s.socialProof.customerLogos.map((l) => l.name)).toEqual([
      "Celsia",
      "React Flow",
      "RevTron",
    ]);
  });
  it("excludes accent-color 'brand-*' feature cards (no AI-icon / decorative art)", () => {
    const names = s.socialProof.customerLogos.map((l) => l.name);
    expect(names).not.toContain("AI Services");
    expect(names).not.toContain("Transparent lines");
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

describe("isIncompleteRender", () => {
  // Mirrors a real production capture (misprint.com): a client-rendered SPA that
  // served its error boundary with HTTP 200 — the static nav/footer shell rendered
  // but the main content is a single "Something went wrong" blurb, no hero.
  const ERROR_BOUNDARY = `<!doctype html><html><head>
    <title>Misprint: Buy and Sell Pokémon Cards</title>
  </head><body>
    <header><nav><a href="/shop">Shop All</a><a href="/join">Join</a></nav></header>
    <main>
      <section>
        <h2>Something went wrong</h2>
        <p>We're sorry for the inconvenience. Please try refreshing the page.</p>
      </section>
    </main>
    <footer><a href="/about">About Us</a><a href="/careers">Careers</a></footer>
  </body></html>`;

  it("flags an SPA error boundary (no hero, one blurb section) as incomplete", () => {
    expect(isIncompleteRender(parseHomepageStructure(ERROR_BOUNDARY, BASE))).toBe(true);
  });

  it("does not flag a real homepage with a hero", () => {
    expect(isIncompleteRender(parseHomepageStructure(HOMEPAGE, BASE))).toBe(false);
  });

  it("does not flag a heroless page that still carries several sections", () => {
    const heroless = `<!doctype html><html><head><title>Docs</title></head><body>
      <section><h2>Guides</h2><p>Getting started with the platform.</p></section>
      <section><h2>Reference</h2><p>Full API reference for every endpoint.</p></section>
      <section><h2>Support</h2><p>Reach the team through chat or email.</p></section>
    </body></html>`;
    expect(isIncompleteRender(parseHomepageStructure(heroless, BASE))).toBe(false);
  });
});
