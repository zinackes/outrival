import { describe, expect, it } from "bun:test";
import { computeHash, computeTextDiff } from "@outrival/shared";
import { extractContent, isContentCollapsed } from "../extract-content";

// Two captures of the *same* marketing page that differ only in churn the user
// never sees — exactly what made Linear's homepage report a phantom "pricing
// change" on every scrape.
const NOISE_BEFORE = `<!doctype html><html><head>
  <title>Linear – Plan and build products</title>
  <meta name="description" content="Linear is the issue tracker for high-performance teams.">
  <style>:root{--chakra-vh:100vh;}@supports (height:-webkit-fill-available){:root{--chakra-vh:-webkit-fill-available;}}</style>
  <script nonce="n-aaa">window.__STATE__={ts:1717000000000,session:"sess-aaa"}</script>
</head><body>
  <header><nav class="css-1a2b3c"><a class="css-9z8y7x" href="/pricing?ref=abc">Pricing</a></nav></header>
  <main>
    <h1 class="css-deadbeef">Linear is a better way to build products</h1>
    <p class="css-f00ba7">Streamline issues, projects, and product roadmaps.</p>
    <button class="css-cta-111">Get started</button>
    <svg viewBox="0 0 100 100"><path d="M12.9266 16.3713c-.5283.5806-.4933 1.4714.0617 2.0265l68.5946 68.5946Z"/></svg>
    <img src="/logo.aaa111.svg" alt="Linear logo">
  </main>
</body></html>`;

const NOISE_AFTER = `<!doctype html><html><head>
  <title>Linear – Plan and build products</title>
  <meta name="description" content="Linear is the issue tracker for high-performance teams.">
  <style>:root{--chakra-vh:100dvh;}@supports (height:-moz-fill-available){:root{--chakra-vh:-moz-fill-available;}}</style>
  <script nonce="n-bbb">window.__STATE__={ts:1717999999999,session:"sess-bbb"}</script>
</head><body>
  <header><nav class="css-77fffa"><a class="css-00ee11" href="/pricing?ref=xyz">Pricing</a></nav></header>
  <main>
    <h1 class="css-cafe42">Linear is a better way to build products</h1>
    <p class="css-9988aa">Streamline issues, projects, and product roadmaps.</p>
    <button class="css-cta-999">Get started</button>
    <svg viewBox="0 0 100 100"><path d="M201.602 27.535c3.587 0 6.494-2.918 6.494-6.5175S205.189 14.5Z"/></svg>
    <img src="/logo.bbb222.svg" alt="Linear logo">
  </main>
</body></html>`;

describe("extractContent — noise immunity", () => {
  it("ignores CSS-in-JS class hashes, <style>, SVG paths, hydration scripts, nonces", () => {
    const before = extractContent(NOISE_BEFORE, "homepage");
    const after = extractContent(NOISE_AFTER, "homepage");

    expect(after).toBe(before);
    expect(computeHash(after)).toBe(computeHash(before));
    expect(computeTextDiff(before, after).hasChanges).toBe(false);
  });

  it("drops inline-hidden content (mobile-menu dupes, pre-rendered modals)", () => {
    const html = `<body>
      <nav><ul><li>Pricing</li><li>Docs</li></ul></nav>
      <ul class="mobile-menu" style="display:none"><li>Pricing</li><li>Docs</li></ul>
      <div class="modal" style="display: none"><h2>Newsletter signup</h2></div>
      <main><h1>Build faster</h1></main>
    </body>`;
    const content = extractContent(html, "homepage");
    expect(content).toContain("Build faster");
    expect(content).not.toContain("Newsletter signup");
    // "Pricing" appears once (visible nav), not duplicated by the hidden menu.
    expect(content.split("\n").filter((l) => l === "Pricing").length).toBe(1);
  });

  it("emits the visible copy, never CSS rules or SVG path data", () => {
    const content = extractContent(NOISE_BEFORE, "homepage");

    expect(content).toContain("Linear is a better way to build products");
    expect(content).toContain("Get started");
    expect(content).toContain("Linear logo"); // img alt
    expect(content).not.toContain("--chakra-vh");
    expect(content).not.toContain("path");
    expect(content).not.toMatch(/css-[0-9a-f]/);
    expect(content).not.toContain("session");
  });
});

describe("extractContent — real changes surface cleanly", () => {
  it("captures a headline change as exactly that line, with no markup noise", () => {
    const before = extractContent(NOISE_BEFORE, "homepage");
    const changedHtml = NOISE_AFTER.replace(
      "Linear is a better way to build products",
      "Linear is the fastest way to build software",
    );
    const after = extractContent(changedHtml, "homepage");

    const diff = computeTextDiff(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added.join("\n")).toContain("fastest way to build software");
    expect(diff.removed.join("\n")).toContain("better way to build products");
    // The churn (classes, svg, styles) must not leak into the diff.
    expect(diff.added.join("\n")).not.toMatch(/css-|chakra|path/);
    expect(diff.removed.join("\n")).not.toMatch(/css-|chakra|path/);
  });

  it("surfaces a price change (numbers are never normalised away)", () => {
    const before = extractContent(`<body><h2>Pro</h2><p>$10/mo</p></body>`, "pricing");
    const after = extractContent(`<body><h2>Pro</h2><p>$20/mo</p></body>`, "pricing");
    const diff = computeTextDiff(before, after);

    expect(diff.added.join("")).toContain("$20/mo");
    expect(diff.removed.join("")).toContain("$10/mo");
  });
});

describe("isContentCollapsed", () => {
  it("flags an empty/failed render (big HTML shell, no visible body)", () => {
    const shell = `<!doctype html><html><head><title>App</title>
      <style>.x{color:red}</style><script>var a=1</script></head>
      <body><div id="root"></div><script>boot()</script></body></html>`;
    expect(isContentCollapsed(extractContent(shell, "homepage"))).toBe(true);
  });

  it("does not flag a real page", () => {
    expect(isContentCollapsed(extractContent(NOISE_BEFORE, "homepage"))).toBe(false);
  });

  it("does not flag on digits/punctuation alone", () => {
    expect(isContentCollapsed("2026 · 1,234 — $99")).toBe(true);
  });
});

describe("extractContent — volatile text", () => {
  it("treats EN relative timestamps as unchanged", () => {
    const before = extractContent(`<body><article><h3>Release 1.2</h3><span>2 hours ago</span></article></body>`, "blog");
    const after = extractContent(`<body><article><h3>Release 1.2</h3><span>5 hours ago</span></article></body>`, "blog");
    expect(after).toBe(before);
    // "a day ago" / "an hour ago" (article instead of a number) too.
    const art = (d: string) => extractContent(`<body><span>${d}</span></body>`, "blog");
    expect(art("a day ago")).toBe(art("3 days ago"));
  });

  it("treats FR/DE/ES relative timestamps as unchanged (localised careers pages)", () => {
    // The bug report: a French careers page shows "il y a 8 jours" and the label
    // recomputes daily, flipping the content hash + firing a phantom job change.
    // The date renders on its own line (its own block element), as on a real
    // job card (title line / location line / posted-date line).
    const fr = (d: string) =>
      extractContent(`<body><ul><li><p>Senior Engineer — Paris</p><p>${d}</p></li></ul></body>`, "jobs");
    expect(fr("il y a 9 jours")).toBe(fr("il y a 8 jours"));
    expect(fr("il y a un mois")).toBe(fr("il y a 8 jours"));

    const de = (d: string) =>
      extractContent(`<body><ul><li><p>Backend — Berlin</p><p>${d}</p></li></ul></body>`, "jobs");
    expect(de("vor 3 Tagen")).toBe(de("vor 5 Tagen"));
    expect(de("vor einer Stunde")).toBe(de("vor 2 Stunden"));

    const es = (d: string) =>
      extractContent(`<body><ul><li><p>Data — Madrid</p><p>${d}</p></li></ul></body>`, "jobs");
    expect(es("hace 2 días")).toBe(es("hace 9 días"));
  });

  it("only neutralises the date token — real numbers on the same line still surface", () => {
    // Proves the normalisation is surgical: the relative date is silenced but a
    // genuine count change ("5 postes" → "3 postes") is NOT swallowed.
    const before = extractContent(`<body><li>Senior Engineer — Paris · il y a 8 jours · 5 postes</li></body>`, "jobs");
    const after = extractContent(`<body><li>Senior Engineer — Paris · il y a 9 jours · 3 postes</li></body>`, "jobs");
    const diff = computeTextDiff(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.added.join("")).toContain("3 postes");
    expect(diff.added.join("")).not.toContain("jours");
  });
});

describe("extractContent — blog index", () => {
  const POSTS = `<body><main>
    <article><h2><a href="/blog/a-1a2">Shipping our new API</a></h2><span>3 min read</span><span>1.2k views</span></article>
    <article><h2><a href="/blog/b-9z8">Designing for speed</a></h2><span>5 min read</span></article>
  </main></body>`;

  it("strips reading-time / view-count chrome but keeps post titles", () => {
    const content = extractContent(POSTS, "blog");
    expect(content).toContain("Shipping our new API");
    expect(content).toContain("Designing for speed");
    expect(content).not.toContain("min read");
    expect(content).not.toContain("views");
  });

  it("reports a brand-new post as a single added line", () => {
    const before = extractContent(POSTS, "blog");
    const withNew = POSTS.replace(
      "<main>",
      `<main><article><h2><a href="/blog/c-new">Our Series B</a></h2><span>2 min read</span></article>`,
    );
    const after = extractContent(withNew, "blog");
    const diff = computeTextDiff(before, after);

    expect(diff.hasChanges).toBe(true);
    expect(diff.added.join("\n")).toContain("Our Series B");
    expect(diff.removed.join("").trim()).toBe("");
  });
});
