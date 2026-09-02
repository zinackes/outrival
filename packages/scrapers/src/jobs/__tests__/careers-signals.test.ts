import { describe, expect, it } from "bun:test";
import { hasCareersSignals } from "../signals";

describe("hasCareersSignals", () => {
  it("accepts a real listing (open positions / we're hiring / apply)", () => {
    const html = `<html><body>
      <h2>Open positions</h2>
      <p>We are hiring across engineering.</p>
      <li>Founding Engineer — Remote</li>
      <p>Apply now.</p>
    </body></html>`;
    expect(hasCareersSignals(html)).toBe(true);
  });

  it("accepts a JobPosting JSON-LD even without visible vocabulary", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@type":"JobPosting","title":"Backend Engineer"}
    </script></head><body><div id="root"></div></body></html>`;
    expect(hasCareersSignals(html)).toBe(true);
  });

  it("rejects a marketing homepage that merely has a 'Careers' chrome link", () => {
    // The SPA false-positive: every path 200s with the app shell; a bare "Careers"
    // nav/footer link must NOT qualify the page as a jobs listing.
    const html = `<html><body>
      <h1>Engineering at the speed of ambition</h1>
      <nav><a href="/pricing">Pricing</a></nav>
      <footer><a href="/careers">Careers</a></footer>
      <p>Describe your product. Start engineering.</p>
    </body></html>`;
    expect(hasCareersSignals(html)).toBe(false);
  });

  it("reads the vocabulary off minified SSR markup (no whitespace between tags)", () => {
    // Regression (OUT-251): rippling.com/careers, gem.com/company/careers and
    // join.com/en/careers all say "See open roles", but their Next.js markup puts no
    // whitespace between tags, so the visible text came out as
    // "LoginSee open rolesRippling careers" and every anchored pattern missed.
    // Discovery then rejected the real careers page and fell back to the homepage.
    const html =
      `<html><body><nav><a href="/login">Login</a><a href="/careers/open-roles">See open roles</a></nav>` +
      `<h1>Rippling careers</h1><p>Work will never be the same.</p></body></html>`;
    expect(hasCareersSignals(html)).toBe(true);
  });

  it("accepts a French listing (nous recrutons / offres d'emploi)", () => {
    expect(hasCareersSignals(`<body><h2>Nous recrutons</h2></body>`)).toBe(true);
    expect(hasCareersSignals(`<body><p>Nos offres d'emploi</p></body>`)).toBe(true);
  });
});
