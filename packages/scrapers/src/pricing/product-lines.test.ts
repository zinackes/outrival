import { expect, test, describe } from "bun:test";
import {
  deriveProductLine,
  buildAggregatedDocument,
  splitProductLines,
} from "./product-lines";

describe("deriveProductLine", () => {
  test("last path segment, hyphens → title", () => {
    expect(deriveProductLine("https://x.com/vps-hosting")).toBe("Vps hosting");
    expect(deriveProductLine("https://x.com/game-hosting/")).toBe("Game hosting");
  });
  test("skips a /products/ wrapper segment", () => {
    expect(deriveProductLine("https://boutique.x.fr/products/vps")).toBe("Vps");
  });
  test("deep game path → leaf", () => {
    expect(deriveProductLine("https://x.com/games/rust")).toBe("Rust");
  });
  test("strips a file extension", () => {
    expect(deriveProductLine("https://x.com/store/cart.php")).toBe("Cart");
  });
  test("falls back to <h1> when the path is empty", () => {
    expect(deriveProductLine("https://x.com/", "<h1>Dedicated Servers</h1>")).toBe(
      "Dedicated Servers",
    );
  });
  test("last resort label", () => {
    expect(deriveProductLine("https://x.com/")).toBe("Plans");
  });
});

describe("buildAggregatedDocument / splitProductLines", () => {
  test("round-trips lines and their content", () => {
    const doc = buildAggregatedDocument([
      { line: "VPS", html: "<html><body><div class='card'><h3>Starter</h3><span>€5/mo</span></div></body></html>" },
      { line: "Game", html: "<html><body><div class='card'><h3>10 slots</h3><span>€3/mo</span></div></body></html>" },
    ]);
    const sections = splitProductLines(doc);
    expect(sections.map((s) => s.line)).toEqual(["VPS", "Game"]);
    expect(sections[0]!.html).toContain("Starter");
    expect(sections[0]!.html).toContain("€5/mo");
    expect(sections[1]!.html).toContain("10 slots");
  });

  test("plain (non-aggregated) html → one section, line null", () => {
    const sections = splitProductLines("<body><h1>Pricing</h1><span>$9/mo</span></body>");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.line).toBeNull();
    expect(sections[0]!.html).toContain("$9/mo");
  });

  test("a line name with quotes/angle brackets is escaped and recovered safely", () => {
    const doc = buildAggregatedDocument([
      { line: 'A"B<C', html: "<body><span>$1/mo</span></body>" },
      { line: "D", html: "<body><span>$2/mo</span></body>" },
    ]);
    const sections = splitProductLines(doc);
    expect(sections[0]!.line).toBe('A"B<C');
    expect(sections).toHaveLength(2);
  });
});
