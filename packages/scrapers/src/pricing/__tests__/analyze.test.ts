import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { analyzePricingHtml, extractDemoUrl } from "../analyze";

const FIXTURES = join(import.meta.dir, "..", "__fixtures__");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.html`), "utf8");

describe("analyzePricingHtml", () => {
  test("public page has no note", () => {
    const a = analyzePricingHtml(fixture("linear"));
    expect(a.status).toBe("public");
    expect(a.note).toBeNull();
  });

  test("gated_demo carries a note and a resolved demo URL", () => {
    const a = analyzePricingHtml(fixture("crayon"), "https://www.crayon.co/pricing");
    expect(a.status).toBe("gated_demo");
    expect(a.note).toContain("demo");
    expect(a.demoUrl).toBeTruthy();
    expect(a.demoUrl).toMatch(/^https?:\/\//);
  });

  test("non-gated statuses don't extract a demo URL", () => {
    expect(analyzePricingHtml(fixture("linear")).demoUrl).toBeNull();
  });

  test("promotional flag rides on the analysis", () => {
    const a = analyzePricingHtml(`<body>Pro $29/mo — Black Friday 50% off</body>`);
    expect(a.promotional).toBe(true);
  });
});

describe("extractDemoUrl", () => {
  test("resolves a relative demo href against the base", () => {
    const html = `<body><a href="/request-a-demo">Book a demo</a></body>`;
    expect(extractDemoUrl(html, "https://acme.com/pricing")).toBe("https://acme.com/request-a-demo");
  });

  test("returns null when there is no demo link", () => {
    expect(extractDemoUrl(`<body><a href="/about">About</a></body>`)).toBeNull();
  });
});
