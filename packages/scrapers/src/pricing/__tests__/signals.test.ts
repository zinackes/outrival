import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { detectPricingSignals, extractVisibleText } from "../signals";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), "utf8");

describe("extractVisibleText", () => {
  test("strips script and style bodies", () => {
    const html = `<body><h1>Plans</h1><script>var x="$99/mo contact sales"</script><style>.a{color:red}</style><p>Pro $29/mo</p></body>`;
    const text = extractVisibleText(html);
    expect(text).toContain("Pro $29/mo");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("color:red");
  });
});

describe("detectPricingSignals — prices", () => {
  test("detects $ and € amounts with and without period", () => {
    const s = detectPricingSignals(`<body>Free $0 · Pro $29/mo · Team €49 / month</body>`);
    expect(s.hasPriceTokens).toBe(true);
    expect(s.priceMatches.length).toBeGreaterThanOrEqual(2);
  });

  test("ignores price-like tokens hidden in scripts", () => {
    const s = detectPricingSignals(`<body><script>const p="$29/mo"</script><p>Contact us</p></body>`);
    expect(s.hasPriceTokens).toBe(false);
  });
});

describe("detectPricingSignals — gated keywords (EN + FR)", () => {
  test.each([
    ["Contact sales for Enterprise"],
    ["Book a demo"],
    ["Get a Demo"],
    ["Schedule a demo"],
    ["Talk to sales"],
    ["Talk to an expert"],
    ["Custom pricing"],
    ["Nous contacter"],
    ["Sur demande"],
  ])("flags %p", (snippet) => {
    expect(detectPricingSignals(`<body>${snippet}</body>`).hasGatedKeywords).toBe(true);
  });

  test("plain pricing copy is not gated", () => {
    expect(detectPricingSignals(`<body>Pro $29/mo. Cancel anytime.</body>`).hasGatedKeywords).toBe(false);
  });
});

describe("detectPricingSignals — calculator", () => {
  test("detects number/range inputs in raw html", () => {
    expect(detectPricingSignals(`<body><input type="number" name="seats"></body>`).hasCalculator).toBe(true);
    expect(detectPricingSignals(`<body><input type='range'></body>`).hasCalculator).toBe(true);
  });

  test("detects calculator phrasing", () => {
    expect(detectPricingSignals(`<body>Estimate your cost</body>`).hasCalculator).toBe(true);
    expect(detectPricingSignals(`<body>How many seats do you need?</body>`).hasCalculator).toBe(true);
  });

  test("detects usage-based vocabulary (dynamic pricing)", () => {
    expect(detectPricingSignals(`<body>Pay as you go</body>`).hasCalculator).toBe(true);
    expect(detectPricingSignals(`<body>Usage-based pricing</body>`).hasCalculator).toBe(true);
    expect(detectPricingSignals(`<body>Based on your Monthly Tracked Users</body>`).hasCalculator).toBe(true);
  });
});

// Real captured pricing pages (2026-06-01) — guards the regexes against actual
// markup, not just hand-written snippets. See findings.md for the capture note.
describe("detectPricingSignals — real fixtures", () => {
  test("Linear: prices visible, not gated", () => {
    const s = detectPricingSignals(fixture("linear"));
    expect(s.hasPriceTokens).toBe(true);
  });

  test("Notion: prices + a gated Enterprise tier", () => {
    const s = detectPricingSignals(fixture("notion"));
    expect(s.hasPriceTokens).toBe(true);
    expect(s.hasGatedKeywords).toBe(true);
  });

  test("Crayon: demo-gated, no public prices", () => {
    const s = detectPricingSignals(fixture("crayon"));
    expect(s.hasGatedKeywords).toBe(true);
    expect(s.hasPriceTokens).toBe(false);
  });

  test("Segment: usage-based calculator detected", () => {
    const s = detectPricingSignals(fixture("segment"));
    expect(s.hasCalculator).toBe(true);
  });
});

describe("detectPricingSignals — signup wall", () => {
  test("detects EN and FR walls", () => {
    expect(detectPricingSignals(`<body>Sign up to see pricing</body>`).hasSignupWall).toBe(true);
    expect(detectPricingSignals(`<body>Créer un compte pour voir les tarifs</body>`).hasSignupWall).toBe(true);
  });
});

describe("detectPricingSignals — promotional", () => {
  test.each([
    ["Black Friday — 50% off"],
    ["Limited time offer"],
    ["Lifetime deal"],
    ["Offre limitée"],
    ["Économisez maintenant"],
  ])("flags %p", (snippet) => {
    expect(detectPricingSignals(`<body>${snippet}</body>`).hasPromotionalText).toBe(true);
  });

  test("regular pricing is not promotional", () => {
    expect(detectPricingSignals(`<body>Pro $29/mo billed yearly</body>`).hasPromotionalText).toBe(false);
  });
});
