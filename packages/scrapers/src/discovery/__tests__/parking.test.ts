import { expect, test } from "bun:test";
import { isParkedPage } from "../discover";

// Real signatures served by backand.com (a defunct BaaS whose domain was resold
// to DomainMarket and now answers HTTP 200 — the case that motivated this filter).
const BACKAND_HTML = `
<title>backand.com - technology domains for sale - buy premium tech domain names | domain for sale.</title>
<meta name="description" content="backand.com - a great premium domain available for sale.">
<script src="https://cdn.domainmarket.com/parking.js"></script>
`.toLowerCase();

test("parked domain served on its own host (backand.com / domainmarket)", () => {
  expect(isParkedPage("backand.com", BACKAND_HTML)).toBe(true);
});

test("final host is a parking provider after redirect", () => {
  expect(isParkedPage("sedoparking.com", "<html><body>parked</body></html>")).toBe(true);
  expect(isParkedPage("www.hugedomains.com", "<html></html>")).toBe(true);
});

test("for-sale copy without a known provider host", () => {
  expect(isParkedPage("acme.io", "<h1>this domain is for sale</h1>")).toBe(true);
  expect(isParkedPage("acme.io", "welcome — buy this domain today")).toBe(true);
});

test("real product page is not flagged", () => {
  const html = `
    <title>linear — the issue tracker built for modern software teams</title>
    <meta name="description" content="linear streamlines issues, sprints, and product roadmaps.">
    plans start at $8/seat. everything you need to ship.
  `.toLowerCase();
  expect(isParkedPage("linear.app", html)).toBe(false);
});

test("legitimate 'for sale' copy that is not about a domain is not flagged", () => {
  const html = "browse thousands of homes for sale in your area.".toLowerCase();
  expect(isParkedPage("zillow-clone.io", html)).toBe(false);
});
