import { expect, test } from "bun:test";
import { needsRenderRetry } from "../render-retry";

// An SSR marketing shell with plenty of copy (> 500 chars, clears scrape-direct's
// text-length bar) but zero price tokens — the shape of a client-rendered pricing
// page whose price cards mount after hydration and never make it into the L0 HTML.
const SSR_SHELL_NO_PRICE = `
  <html><body>
    <header><h1>The platform teams choose</h1></header>
    <main>
      <p>Outrival helps growing teams keep an eye on every competitor, automatically
      tracking pricing pages, job boards, review sites, and product changelogs so your
      team never gets caught off guard by a competitor's move again.</p>
      <p>Trusted by hundreds of product and marketing teams worldwide, our platform
      surfaces the signal buried in the noise: a new hire, a pricing change, a glowing
      review, or a quiet feature launch. We turn all of that into weekly digests and
      real-time alerts so you can react fast.</p>
      <div id="pricing-root"></div>
      <footer>© Outrival, Inc. All rights reserved.</footer>
    </main>
  </body></html>
`;

const PRICED_HTML = `<html><body><div class="price">€29/mo</div></body></html>`;
const FR_PRICED_HTML = `<html><body><div class="price">29 € / mois</div></div></body></html>`;

test("L0 capture with no harvestable price → needs a render retry", () => {
  expect(needsRenderRetry(SSR_SHELL_NO_PRICE, 0)).toBe(true);
});

test("L0 capture with a harvestable price → no retry needed", () => {
  expect(needsRenderRetry(PRICED_HTML, 0)).toBe(false);
});

test("same priceless HTML at browser level (1) → no retry (already rendered)", () => {
  expect(needsRenderRetry(SSR_SHELL_NO_PRICE, 1)).toBe(false);
});

test("FR-format price parses → no retry (guards against double-rendering FR pages)", () => {
  expect(needsRenderRetry(FR_PRICED_HTML, 0)).toBe(false);
});
