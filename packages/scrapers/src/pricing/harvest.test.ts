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

describe("harvestPricing — currency + period coverage", () => {
  const card = (title: string, price: string) =>
    `<body><div class="card"><h3>${title}</h3><span class="price">${price}</span></div></body>`;

  test("ISO code before the amount (USD 29)", () => {
    const { plans } = harvestPricing(card("Pro", "USD 29 / mo"));
    expect(plans[0]!.price).toBe(29);
    expect(plans[0]!.currency).toBe("USD");
  });

  test("ISO code after the amount (29 CHF)", () => {
    const { plans } = harvestPricing(card("Pro", "29 CHF / mo"));
    expect(plans[0]!.price).toBe(29);
    expect(plans[0]!.currency).toBe("CHF");
  });

  test("R$ wins over a bare $ (BRL, not USD)", () => {
    const { plans } = harvestPricing(card("Pro", "R$ 49/mo"));
    expect(plans[0]!.price).toBe(49);
    expect(plans[0]!.currency).toBe("BRL");
  });

  test("non-latin symbols map to their ISO code", () => {
    expect(harvestPricing(card("Pro", "₹499/mo")).plans[0]!.currency).toBe("INR");
    expect(harvestPricing(card("Pro", "299 zł")).plans[0]!.currency).toBe("PLN");
  });

  test("a letter-glued dollar is still USD, not A$ (media$29)", () => {
    const { plans } = harvestPricing(`<body><div>media$29/mo</div></body>`);
    expect(plans[0]!.price).toBe(29);
    expect(plans[0]!.currency).toBe("USD");
  });

  test("'Try 30 days free' is not a price (TRY is not an ISO candidate)", () => {
    expect(harvestPricing(`<body><h1>Try 30 days free</h1></body>`).plans).toEqual([]);
  });

  test("'$10/mo billed annually' is a MONTHLY rate, not $10/year", () => {
    const { plans } = harvestPricing(card("Pro", "$10/mo billed annually"));
    expect(plans[0]!.price).toBe(10);
    expect(plans[0]!.billing_period).toBe("monthly");
  });

  test("'$99 billed annually' (no per-month token) stays yearly", () => {
    const { plans } = harvestPricing(card("Pro", "$99 billed annually"));
    expect(plans[0]!.billing_period).toBe("yearly");
  });

  test("'$1,188/year' still reads as yearly", () => {
    const { plans } = harvestPricing(card("Annual", "$1,188/year"));
    expect(plans[0]!.price).toBe(1188);
    expect(plans[0]!.billing_period).toBe("yearly");
  });
});

describe("harvestPricing — the period default follows the page, not SaaS", () => {
  test("catalog page with no recurring vocabulary → one_time, not monthly", () => {
    // An installer / e-commerce page: a bare amount is a purchase, not a subscription.
    const html = `
      <body>
        <div class="card"><h3>Tesla Powerwall 3</h3><span class="price">4000€</span></div>
        <p>Livraison et pose incluses.</p>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.price).toBe(4000);
    expect(plans[0]!.billing_period).toBe("one_time");
  });

  test("period vocabulary in prose, far from any price, is not a subscription signal", () => {
    // Real regression (sorelenergies.fr): a solar installer's FAQ ("1 à 2 fois par
    // an") and a "kWh/an" spec both match YEARLY, nowhere near an amount. The probe
    // climbs out of the price card but stops before such a section — hence the
    // filler, which stands in for the kilobytes of copy any real page carries.
    const filler = "Nos équipes interviennent partout en France. ".repeat(12);
    const html = `
      <body>
        <div class="card"><h3>Pack Essentiel</h3><span class="price">13 000€</span></div>
        <p>Production estimée : 4500 kWh/an. ${filler}</p>
        <p>Il est conseillé de nettoyer vos panneaux 1 à 2 fois par an. ${filler}</p>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.plan_name).toBe("Pack Essentiel");
    expect(plans[0]!.billing_period).toBe("one_time");
  });

  test("a German card states its period above the amount (sevdesk)", () => {
    // "pro Monat" sits several levels up from the price, not beside it.
    const html = `
      <body>
        <div class="tariff">
          <div class="head"><h3>Rechnung</h3><small>pro Monat, zzgl. MwSt.</small></div>
          <div class="body"><div class="price"><span>11,90 €</span></div></div>
        </div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.billing_period).toBe("monthly");
  });

  test("a Spanish '/mes' is monthly, and carries the page default", () => {
    const html = `
      <body>
        <div class="card"><h3>Basic</h3><span class="price">14,50 €/mes</span></div>
        <div class="card"><h3>Extra</h3><span class="price">29,00 €</span></div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.find((p) => p.plan_name === "Basic")!.billing_period).toBe("monthly");
    expect(plans.find((p) => p.plan_name === "Extra")!.billing_period).toBe("monthly");
  });

  test("a bare French 'mes' is not a Spanish month", () => {
    // `\bmes\b` unanchored would read "mes données" as "per month".
    const html = `
      <body>
        <div class="card"><h3>Installation</h3><span class="price">4000€</span>
          <p>Toutes mes données restent en France.</p>
        </div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.billing_period).toBe("one_time");
  });

  test("an untokened card on a page that DOES sell subscriptions stays monthly", () => {
    // "Pro" carries no /mo of its own, but the page is plainly a subscription grid.
    const html = `
      <body>
        <div class="card"><h3>Starter</h3><span class="price">€9/mo</span></div>
        <div class="card"><h3>Pro</h3><span class="price">€29</span></div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.find((p) => p.plan_name === "Pro")!.billing_period).toBe("monthly");
  });

  test("a per-seat page keeps the monthly default for its untokened prices", () => {
    const html = `
      <body>
        <div class="card"><h3>Team</h3><span class="price">$12 per seat</span></div>
        <div class="card"><h3>Add-on</h3><span class="price">$5</span></div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.find((p) => p.plan_name === "Add-on")!.billing_period).toBe("monthly");
  });

  test("a price lead-in is a band, never the plan name nor a section banner", () => {
    // Real regression: "À partir de" sat closest to the amount and was harvested as
    // the plan's name. Skipping it must not promote the banner above it either.
    const html = `
      <body>
        <section><h2>Installation partout en France</h2>
          <div class="card"><h4>À partir de</h4><span class="price">4000€</span></div>
        </section>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.plan_name).toBe("From");
    expect(plans[0]!.price).toBe(4000);
  });

  test("a real card title above the lead-in still wins", () => {
    const html = `
      <body>
        <div class="card">
          <h3>Tesla Powerwall 3</h3><h4>À partir de</h4><span class="price">4000€</span>
        </div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans[0]!.plan_name).toBe("Tesla Powerwall 3");
  });

  test("English lead-ins are treated the same", () => {
    const html = `<body><div class="card"><h4>Starting at</h4><span class="price">$99</span></div></body>`;
    expect(harvestPricing(html).plans[0]!.plan_name).toBe("From");
  });

  test("one-off vocabulary alone does not force a monthly default", () => {
    const html = `
      <body>
        <div class="card"><h3>Lifetime</h3><span>$249 one-time</span></div>
        <div class="card"><h3>Install</h3><span>$99</span></div>
      </body>`;
    const { plans } = harvestPricing(html);
    expect(plans.find((p) => p.plan_name === "Install")!.billing_period).toBe("one_time");
  });
});
