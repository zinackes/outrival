import { describe, expect, it } from "bun:test";
import { pruneHtmlForSelectors, SELECTOR_ANCHORS } from "../src/lib/prune-html";

const PRICE = SELECTOR_ANCHORS.pricing!;

/** Tag-heavy filler, so the skeleton overflows the way a real page's does. */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `<div class="nav-item-${i}"><span>item ${i}</span></div>`).join("");

describe("pruneHtmlForSelectors", () => {
  it("strips scripts, styles and head noise", () => {
    const out = pruneHtmlForSelectors(
      `<html><head><title>x</title></head><body><script>evil()</script><style>a{}</style><div class="plan">Pro</div></body></html>`,
    );
    expect(out).not.toContain("evil()");
    expect(out).not.toContain("a{}");
    expect(out).toContain('class="plan"');
  });

  it("keeps the tags and class names the generator reasons over", () => {
    const out = pruneHtmlForSelectors(`<body><ul class="tiers"><li data-tier="pro">Pro</li></ul></body>`);
    expect(out).toContain('class="tiers"');
    expect(out).toContain('data-tier="pro"');
  });

  it("clips long copy but leaves a price intact", () => {
    const out = pruneHtmlForSelectors(
      `<body><p>${"lorem ".repeat(60)}</p><span class="price">$29/mo</span></body>`,
    );
    expect(out).toContain("…");
    expect(out).toContain("$29/mo");
  });

  // Below the cap nothing may move: every page that already worked must be
  // byte-identical to what it was before anchoring existed.
  it("is byte-identical below the cap, anchor or not", () => {
    const html = `<body><div class="plan">Pro</div><span>$29</span></body>`;
    expect(pruneHtmlForSelectors(html, { anchor: PRICE })).toBe(pruneHtmlForSelectors(html));
  });

  it("keeps the head slice when the anchor already falls inside it", () => {
    const html = `<body><span class="price">$29</span>${filler(400)}</body>`;
    const out = pruneHtmlForSelectors(html, { maxChars: 2000, anchor: PRICE });
    expect(out).toBe(pruneHtmlForSelectors(html, { maxChars: 2000 }));
    expect(out).toContain("$29");
  });

  // The measured failure: a pricing table below the nav, the hero and the features,
  // past a cap the tag-heavy skeleton reaches first. Head-slicing hands the model a
  // page with no prices in it, and it answers — correctly — that there are none.
  it("windows onto the prices when they sit past the cap", () => {
    const html = `<body>${filler(600)}<div class="pricing"><span class="price">$29/mo</span></div></body>`;
    const headSliced = pruneHtmlForSelectors(html, { maxChars: 4000 });
    const anchored = pruneHtmlForSelectors(html, { maxChars: 4000, anchor: PRICE });

    expect(headSliced).not.toContain("$29/mo");
    expect(anchored).toContain("$29/mo");
    expect(anchored).toContain('class="pricing"');
    expect(anchored.length).toBeLessThanOrEqual(4000);
  });

  it("keeps lead-in ahead of the price so a container is still nameable", () => {
    const html = `<body>${filler(600)}<div class="pricing-section"><h2>Plans</h2><div class="tier"><span class="price">$29/mo</span></div></div></body>`;
    const anchored = pruneHtmlForSelectors(html, { maxChars: 6000, anchor: PRICE });
    expect(anchored).toContain('class="pricing-section"');
    expect(anchored).toContain('class="tier"');
  });

  it("falls back to the head slice when the anchor never matches", () => {
    const html = `<body>${filler(600)}<div class="pricing">Contact sales</div></body>`;
    expect(pruneHtmlForSelectors(html, { maxChars: 3000, anchor: PRICE })).toBe(
      pruneHtmlForSelectors(html, { maxChars: 3000 }),
    );
  });

  // jobs declares no anchor, so its behaviour must not have moved at all.
  it("leaves a kind with no anchor on exactly the old behaviour", () => {
    const html = `<body>${filler(600)}<div class="job">Engineer</div></body>`;
    expect(pruneHtmlForSelectors(html, { maxChars: 3000, anchor: SELECTOR_ANCHORS.jobs })).toBe(
      pruneHtmlForSelectors(html, { maxChars: 3000 }),
    );
  });

  it("never throws on malformed input", () => {
    expect(() => pruneHtmlForSelectors("<div><span>unclosed")).not.toThrow();
  });
});
