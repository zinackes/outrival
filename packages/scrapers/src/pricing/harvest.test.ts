import { expect, test, describe } from "bun:test";
import { harvestPricing, parseAmount } from "./harvest";

describe("parseAmount", () => {
  test("plain integer", () => expect(parseAmount("29")).toBe(29));
  test("FR decimal comma", () => expect(parseAmount("2,99")).toBe(2.99));
  test("EN decimal dot", () => expect(parseAmount("9.99")).toBe(9.99));
  test("EN thousands + decimal", () => expect(parseAmount("1,299.00")).toBe(1299));
  test("FR thousands (space) + decimal comma", () =>
    expect(parseAmount("1 299,00")).toBe(1299));
  test("dot thousands, no decimal", () => expect(parseAmount("1.299")).toBe(1299));
  test("garbage", () => expect(parseAmount("abc")).toBeNull());
});

describe("harvestPricing", () => {
  test("named tier cards → one plan per titled card", () => {
    const html = `
      <body>
        <div class="card"><h3>Starter</h3><span class="price">€9/mo</span></div>
        <div class="card"><h3>Pro</h3><span class="price">€29/mo</span></div>
        <div class="card"><h3>Business</h3><span class="price">€99/mo</span></div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.map((p) => p.plan_name)).toEqual(["Starter", "Pro", "Business"]);
    expect(plans.map((p) => p.price)).toEqual([9, 29, 99]);
    expect(plans.every((p) => p.currency === "EUR")).toBe(true);
    expect(plans.every((p) => p.billing_period === "monthly")).toBe(true);
  });

  test("price split across inner spans still resolves", () => {
    const html = `
      <body>
        <div class="plan"><h4>Rust 10 slots</h4>
          <div class="price"><b>4</b><b>,99</b><small>€/mois</small></div>
        </div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.plan_name).toBe("Rust 10 slots");
    expect(plans[0]!.price).toBe(4.99);
    expect(plans[0]!.billing_period).toBe("monthly");
  });

  test("no titles → From / Up to band", () => {
    const html = `
      <body>
        <section>VPS hosting starting at $5.00/mo</section>
        <section>Dedicated from $120.00/mo</section>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.map((p) => p.plan_name)).toEqual(["From", "Up to"]);
    expect(plans[0]!.price).toBe(5);
    expect(plans[1]!.price).toBe(120);
  });

  test("single price with no title → From only (no Up to)", () => {
    const html = `<body><div>Only $10/mo here</div></body>`;
    const { plans } = harvestPricing(html);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.plan_name).toBe("From");
    expect(plans[0]!.price).toBe(10);
  });

  test("usage unit → usage period + unit", () => {
    const html = `<body><div class="card"><h3>Bandwidth</h3><span>$0.10 / GB</span></div></body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.billing_period).toBe("usage");
    expect(plans[0]!.unit).toBe("gb");
  });

  test("yearly period detected", () => {
    const html = `<body><div class="card"><h3>Annual</h3><span class="price">$290/year</span></div></body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.billing_period).toBe("yearly");
  });

  test("a section heading shared across prices → band, not N identical rows", () => {
    // The nearest heading is one section title reused for every card → not per-plan.
    const html = `
      <body>
        <section><h2>Affordable Pricing</h2>
          <div class="card"><span>$0.85/mo</span></div>
          <div class="card"><span>$1/mo</span></div>
          <div class="card"><span>$4/mo</span></div>
        </section>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.map((p) => p.plan_name)).toEqual(["From", "Up to"]);
    expect(plans[0]!.price).toBe(0.85);
    expect(plans[1]!.price).toBe(4);
  });

  test("no prices → empty", () => {
    const html = `<body><h1>Contact us for a quote</h1><p>No public pricing.</p></body>`;
    expect(harvestPricing(html).plans).toEqual([]);
  });

  test("a price element is not mistaken for its own title", () => {
    // The card title must not be the price span itself.
    const html = `<body><div class="card"><div class="title">€49/mo</div></div></body>`;
    const { plans } = harvestPricing(html);
    // No usable title (only a price) → falls back to the band, not label "€49/mo".
    expect(plans[0]!.plan_name).toBe("From");
    expect(plans[0]!.price).toBe(49);
  });
});
