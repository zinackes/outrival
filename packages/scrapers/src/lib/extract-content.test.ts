import { test, expect } from "bun:test";
import { extractContent } from "./extract-content";

// A page that shares the same site chrome (header + a duplicated desktop/mobile
// nav + footer) wrapped around a <main> with the real page content. This mirrors
// fygurs.com, where the nav links ("Contact", "Fygurs Advisory") leaked into the
// pricing/blog lexical diffs as phantom changes (and doubled because the DOM
// carries two <nav> copies).
const PAGE = `<!doctype html><html><body>
  <header>
    <nav><a href="/advisory">Fygurs Advisory</a><a href="/contact">Contact</a></nav>
    <nav><a href="/advisory">Fygurs Advisory</a><a href="/contact">Contact</a></nav>
  </header>
  <main>
    <h1>Pricing</h1>
    <p>Starter plan costs $99 per month.</p>
  </main>
  <footer><a href="/contact">Contact</a><span>© 2026 Fygurs Advisory</span></footer>
</body></html>`;

test("strips shared site chrome (header/nav/footer) for non-homepage sources", () => {
  const out = extractContent(PAGE, "pricing");
  expect(out).toContain("Pricing");
  expect(out).toContain("Starter plan costs $99 per month.");
  // The nav/header/footer boilerplate must not leak into the content diff.
  expect(out).not.toContain("Fygurs Advisory");
  expect(out).not.toContain("Contact");
});

test("blog keeps the same chrome stripping", () => {
  const out = extractContent(PAGE, "blog");
  expect(out).not.toContain("Fygurs Advisory");
  expect(out).toContain("Pricing");
});

test("homepage keeps its chrome (structured diff + relevance filter handle nav)", () => {
  const out = extractContent(PAGE, "homepage");
  // Homepage path is unchanged: the nav text is still part of the extracted body.
  expect(out).toContain("Fygurs Advisory");
});

test("preserves an article-nested <header>/<footer> (real post content)", () => {
  const blogPost = `<!doctype html><html><body>
    <header><nav><a href="/">Home</a></nav></header>
    <main><article>
      <header><h1>Our new operating model</h1><time>June 2026</time></header>
      <p>The body of the post explains the approach in detail.</p>
      <footer>Written by the Fygurs team</footer>
    </article></main>
  </body></html>`;
  const out = extractContent(blogPost, "blog");
  // Site nav stripped…
  expect(out).not.toContain("Home");
  // …but the article's own header/footer survive.
  expect(out).toContain("Our new operating model");
  expect(out).toContain("Written by the Fygurs team");
});
