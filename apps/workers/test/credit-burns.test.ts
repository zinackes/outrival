import { test, expect, describe } from "bun:test";
import {
  prepareCreditBurns,
  MAX_CREDIT_BURNS,
  BURN_GROUNDING_WINDOW,
} from "../src/lib/credit-burns";

// A page that publishes its mapping, the way one actually reads once the markup
// is stripped: an action, then its cost, a few characters apart — with the pack
// prices a section away, which is where a model looking for a burn rate is
// tempted to borrow a number from.
const PAGE = `
Pricing
Credit packs: 1,000 credits for $99. 5,000 credits for $399. Packs never expire and
roll over between months. Team plans pool their balance across every seat, and unused
credits stay available for the whole of the following billing period at no extra cost.
Buy more at any time from the billing screen; volume discounts start at 20,000 credits.
What a credit buys
OCR page — 5 credits
Deep scan — 1 credit
Video export — 12 credits
`;

describe("prepareCreditBurns", () => {
  test("keeps a mapping the page publishes, verbatim wording included", () => {
    const { rows, dropped } = prepareCreditBurns({
      raw: [
        { action: "OCR page", credits: 5 },
        { action: "Deep scan", credits: 1 },
      ],
      pageText: PAGE,
    });
    expect(rows).toEqual([
      { action: "OCR page", credits: 5 },
      { action: "Deep scan", credits: 1 },
    ]);
    expect(dropped).toEqual({ substring: 0, ungrounded: 0, invalid: 0, cap: 0 });
  });

  test("drops an action nobody wrote down", () => {
    const { rows, dropped } = prepareCreditBurns({
      raw: [{ action: "Bulk translate", credits: 3 }],
      pageText: PAGE,
    });
    expect(rows).toEqual([]);
    expect(dropped.substring).toBe(1);
  });

  test("drops a figure the page never printed next to that action", () => {
    const { rows, dropped } = prepareCreditBurns({
      raw: [{ action: "OCR page", credits: 9 }],
      pageText: PAGE,
    });
    expect(rows).toEqual([]);
    expect(dropped.ungrounded).toBe(1);
  });

  test("a figure buried inside a bigger number does not ground anything", () => {
    // "$599" contains "5" and "9"; neither is a credit cost the page stated.
    const page = "Instant render — costs $599 per month";
    expect(
      prepareCreditBurns({ raw: [{ action: "Instant render", credits: 5 }], pageText: page }).rows,
    ).toEqual([]);
  });

  test("a pack size is not a burn rate: derived from far away, it fails grounding", () => {
    const { rows, dropped } = prepareCreditBurns({
      raw: [{ action: "Video export", credits: 1000 }],
      pageText: PAGE,
    });
    expect(rows).toEqual([]);
    expect(dropped.ungrounded).toBe(1);
  });

  test("a large figure is grounded through its printed thousands separator", () => {
    const page = "Batch import — 1,500 credits per run";
    const { rows } = prepareCreditBurns({
      raw: [{ action: "Batch import", credits: 1500 }],
      pageText: page,
    });
    expect(rows).toEqual([{ action: "Batch import", credits: 1500 }]);
  });

  test("zero, negative and non-finite costs are dropped as invalid", () => {
    const { rows, dropped } = prepareCreditBurns({
      raw: [
        { action: "OCR page", credits: 0 },
        { action: "Deep scan", credits: -2 },
        { action: "Video export", credits: Number.NaN },
        { action: "   ", credits: 4 },
      ],
      pageText: PAGE,
    });
    expect(rows).toEqual([]);
    expect(dropped.invalid).toBe(4);
  });

  test("the same action twice keeps the first reading", () => {
    const { rows } = prepareCreditBurns({
      raw: [
        { action: "OCR page", credits: 5 },
        { action: "ocr  page", credits: 5 },
      ],
      pageText: PAGE,
    });
    expect(rows).toHaveLength(1);
  });

  test("a catalog-sized list is capped in page order", () => {
    const many = Array.from({ length: MAX_CREDIT_BURNS + 5 }, (_, i) => ({
      action: `Action ${i}`,
      credits: 2,
    }));
    const pageText = many.map((m) => `${m.action} — 2 credits`).join("\n");
    const { rows, dropped } = prepareCreditBurns({ raw: many, pageText });
    expect(rows).toHaveLength(MAX_CREDIT_BURNS);
    expect(rows[0]!.action).toBe("Action 0");
    expect(dropped.cap).toBe(5);
  });

  test("no extraction means no rows and no complaint", () => {
    expect(prepareCreditBurns({ raw: null, pageText: PAGE }).rows).toEqual([]);
    expect(prepareCreditBurns({ raw: [], pageText: PAGE }).rows).toEqual([]);
  });

  test("the grounding window is a stated distance, not an accident", () => {
    // Filler must be real characters: the normalizer collapses runs of whitespace,
    // so a wall of spaces would shrink to one and the figure would land adjacent.
    const far = `Slow render${"x".repeat(BURN_GROUNDING_WINDOW + 20)}7 credits`;
    expect(prepareCreditBurns({ raw: [{ action: "Slow render", credits: 7 }], pageText: far }).rows).toEqual([]);
    const near = `Slow render costs 7 credits`;
    expect(prepareCreditBurns({ raw: [{ action: "Slow render", credits: 7 }], pageText: near }).rows).toHaveLength(1);
  });
});
