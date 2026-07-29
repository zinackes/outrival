import { test, expect } from "bun:test";
import { readGtm, productNavItems } from "../src/lib/homepage-gtm";

test("a trial CTA reads as self-serve", () => {
  const r = readGtm({ primaryCta: { text: "Start free trial", href: "/signup" } });
  expect(r.motion).toBe("self_serve");
  expect(r.primary).toEqual({ text: "Start free trial", href: "/signup" });
  expect(r.alternate).toBeNull();
});

test("a demo CTA reads as sales-led", () => {
  expect(readGtm({ primaryCta: { text: "Book a demo" } }).motion).toBe("sales_led");
  expect(readGtm({ primaryCta: { text: "Talk to sales" } }).motion).toBe("sales_led");
  expect(readGtm({ primaryCta: { text: "Get a quote" } }).motion).toBe("sales_led");
  expect(readGtm({ primaryCta: { text: "Contact sales" } }).motion).toBe("sales_led");
});

test("a bare Contact link is not a sales motion", () => {
  // The parser falls back to the first link in the hero when nothing looks like a
  // button, and that fallback is often a nav item. "Contact" sits in the nav of the
  // most self-serve products alive, so reading it as sales-led would mislabel them.
  expect(readGtm({ primaryCta: { text: "Contact" } }).motion).toBeNull();
  expect(readGtm({ primaryCta: { text: "Contact us" } }).motion).toBeNull();
});

test("a free DEMO is a sales motion, not a self-serve one", () => {
  // Both vocabularies are present; asking for a demo still means asking a human.
  expect(readGtm({ primaryCta: { text: "Get your free demo" } }).motion).toBe("sales_led");
});

test("the secondary CTA surfaces only the OPPOSITE motion", () => {
  const mixed = readGtm({
    primaryCta: { text: "Get started for free" },
    secondaryCta: { text: "Talk to sales" },
  });
  expect(mixed.motion).toBe("self_serve");
  expect(mixed.alternate).toBe("sales_led");
  expect(mixed.secondary?.text).toBe("Talk to sales");

  const same = readGtm({
    primaryCta: { text: "Sign up" },
    secondaryCta: { text: "Create an account" },
  });
  expect(same.motion).toBe("self_serve");
  expect(same.alternate).toBeNull();
});

test("a secondary CTA that names no motion is dropped, not shown", () => {
  // Both measured on real homepages: the parser's "secondary" is just the next link
  // in the hero, so it is often a disclosure toggle or an event banner.
  const posthog = readGtm({
    primaryCta: { text: "Sign up via web" },
    secondaryCta: { text: "22 more" },
  });
  expect(posthog.motion).toBe("self_serve");
  expect(posthog.secondary).toBeNull();
  expect(posthog.alternate).toBeNull();
});

test("no primary motion means no alternate, even when the secondary has one", () => {
  // Reporting the secondary's motion on its own would call a product sales-led on
  // the strength of the smaller of its two buttons, so the read stays silent.
  const r = readGtm({
    primaryCta: { text: "Explore the platform" },
    secondaryCta: { text: "Talk to sales" },
  });
  expect(r.motion).toBeNull();
  expect(r.alternate).toBeNull();
});

test("an imperative that puts the visitor in the product is self-serve", () => {
  // vercel.com, verbatim: the pair is the whole read, PLG with an enterprise path.
  const r = readGtm({
    primaryCta: { text: "Deploy now" },
    secondaryCta: { text: "Talk to sales" },
  });
  expect(r.motion).toBe("self_serve");
  expect(r.alternate).toBe("sales_led");
});

test("a CTA that asks for neither yields no verdict but keeps its text", () => {
  const r = readGtm({ primaryCta: { text: "Learn more", href: "/product" } });
  expect(r.motion).toBeNull();
  expect(r.primary?.text).toBe("Learn more");
});

test("an absent hero yields an all-null read", () => {
  expect(readGtm(null)).toEqual({
    motion: null,
    alternate: null,
    primary: null,
    secondary: null,
  });
  // A hero whose CTA carries an empty label is the same as no CTA.
  expect(readGtm({ primaryCta: { text: "   " } }).primary).toBeNull();
});

test("nav keeps the product vocabulary and drops what every SaaS ships", () => {
  // posthog.com, verbatim: the two labels that name what they built survive.
  const items = productNavItems([
    { text: "Home" },
    { text: "Self-driving product" },
    { text: "Context warehouse" },
    { text: "Pricing" },
    { text: "Docs" },
    { text: "Demo" },
    { text: "Talk to a human" },
    { text: "Changelog" },
    { text: "Careers" },
  ]);
  expect(items).toEqual(["Self-driving product", "Context warehouse"]);
});

test("nav made only of generic labels yields nothing to render", () => {
  // notion.com, verbatim. "Enterprise" is a segment every B2B nav names and the
  // tiers are on the pricing tab; "Get Notion free" is a CTA parked in the nav.
  expect(
    productNavItems([
      { text: "Developers" },
      { text: "Enterprise" },
      { text: "Pricing" },
      { text: "Request a demo" },
      { text: "Log in" },
      { text: "Get Notion free" },
    ]),
  ).toEqual([]);
});

test("nav dedupes the duplicated desktop and mobile menus", () => {
  expect(
    productNavItems([{ text: "Agents" }, { text: "agents" }, { text: "Evals" }]),
  ).toEqual(["Agents", "Evals"]);
});

test("nav drops a flattened dropdown and a label with no letters", () => {
  const items = productNavItems([
    { text: "Observability for every model you run in production" },
    { text: "→" },
    { text: "Evals" },
    { text: "Datasets" },
  ]);
  expect(items).toEqual(["Evals", "Datasets"]);
});

test("a single surviving label is not a product map", () => {
  // linear.app leaves only "Now" once app entries and generic pages are dropped.
  expect(productNavItems([{ text: "Now" }, { text: "Pricing" }, { text: "Docs" }])).toEqual([]);
});
