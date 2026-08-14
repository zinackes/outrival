import { describe, expect, test } from "bun:test";
import {
  extractVerifiableTokens,
  locateSupportedTokens,
  verifyAgainstSource,
  verifyFieldsAgainstSource,
} from "./posthoc-grounding";

const texts = (r: { unverified: Array<{ text: string }> }) => r.unverified.map((t) => t.text);

describe("extractVerifiableTokens", () => {
  test("groups by kind and keeps the figure as the output wrote it", () => {
    const t = extractVerifiableTokens('They charge $1,299, up 32%, over 10,000 seats — "the new Pro plan".');
    expect(t.amounts.map((a) => a.text)).toEqual(["$1,299"]);
    expect(t.percentages.map((p) => p.text)).toEqual(["32%"]);
    expect(t.numbers.map((n) => n.text)).toEqual(["10,000"]);
    expect(t.quotedSpans.map((q) => q.text)).toEqual(["the new Pro plan"]);
  });

  test("skips single digits, keeps units and multi-digit figures", () => {
    const t = extractVerifiableTokens("3 plans, $99, 40%, 10x, 1,000");
    expect([...t.amounts, ...t.percentages, ...t.numbers].map((x) => x.text)).toEqual([
      "$99",
      "40%",
      "10x",
      "1,000",
    ]);
  });

  test("skips a bare year but keeps one carrying a unit", () => {
    const t = extractVerifiableTokens("Founded in 2019, they pivoted in 2021 — now $2019/mo.");
    expect(t.numbers).toEqual([]);
    expect(t.amounts.map((a) => a.text)).toEqual(["$2019"]);
  });
});

describe("verifyAgainstSource — figures", () => {
  test("an amount stated by the source is verified", () => {
    expect(verifyAgainstSource("They now charge $99/mo.", "Pro plan — $99 per month").verified).toBe(
      true,
    );
  });

  test("a derived percentage the source never prints is unverified", () => {
    const r = verifyAgainstSource("Raised the Pro tier to $99, a 41% jump.", "Pro was $70, now $99");
    expect(texts(r)).toEqual(["41%"]);
    expect(r.verified).toBe(false);
  });

  test("an invented count is unverified", () => {
    const r = verifyAgainstSource("Now serving over 10,000 customers.", "Trusted by teams worldwide");
    expect(texts(r)).toEqual(["10,000"]);
  });

  test("the same invented figure twice is reported once", () => {
    const r = verifyAgainstSource("10,000 seats today, 10,000 tomorrow.", "no numbers here");
    expect(texts(r)).toEqual(["10,000"]);
    expect(r.checked).toBe(2);
  });

  test("a single digit never has to appear alone in the source", () => {
    expect(verifyAgainstSource("Added 3 plans and 2 add-ons.", "").verified).toBe(true);
  });

  test("nothing to check reads as verified, and says how much it checked", () => {
    const r = verifyAgainstSource("They rewrote their homepage headline.", "some source text");
    expect(r).toEqual({ verified: true, unverified: [], checked: 0 });
  });
});

describe("verifyAgainstSource — normalisation", () => {
  test("thousands separators, currency symbols and non-breaking spaces all reconcile", () => {
    // The three ways the same price is printed, against each other.
    expect(verifyAgainstSource("1 299 €", "the Pro plan costs $1,299").verified).toBe(true);
    expect(verifyAgainstSource("$1,299", "1299 EUR one-time").verified).toBe(true);
    expect(verifyAgainstSource("1 299 EUR", "1.299 € par an").verified).toBe(true);
    expect(verifyAgainstSource("over 10,000 users", "10000 teams and counting").verified).toBe(true);
  });

  test("a percentage matches with or without a space before the sign", () => {
    expect(verifyAgainstSource("up 32%", "grew by 32 % last year").verified).toBe(true);
    expect(verifyAgainstSource("up 32 %", "a 32% increase").verified).toBe(true);
  });

  test("the k suffix expands through the explicit table", () => {
    expect(verifyAgainstSource("10k seats", "10 000 seats included").verified).toBe(true);
    expect(verifyAgainstSource("10k seats", "10,000 seats included").verified).toBe(true);
    expect(verifyAgainstSource("$5M raised", "raised 5 000 000 USD").verified).toBe(true);
    // Nothing outside the table is rescaled: 1.3 is never read as 1300.
    expect(verifyAgainstSource("1.3 seats", "1300 seats").verified).toBe(false);
  });

  test("a decimal is matched on its value, not its formatting", () => {
    expect(verifyAgainstSource("rated 4.8 stars", "score: 4.8/5").verified).toBe(true);
    expect(texts(verifyAgainstSource("rated 4.8 stars", "score: 4.5/5"))).toEqual(["4.8"]);
  });

  test("grouped digits are never invented out of adjacent small numbers", () => {
    // "3 plans and 4 add-ons" must not read as 3004 and must not be checked at all.
    expect(verifyAgainstSource("3 plans and 4 add-ons", "").verified).toBe(true);
  });
});

describe("verifyAgainstSource — quoted spans", () => {
  test("a quotation the page really prints is verified, whatever its spacing or case", () => {
    const source = "Hero:  The   fastest way to ship\nSubhead: for teams";
    expect(verifyAgainstSource('They now say "the fastest way to ship".', source).verified).toBe(
      true,
    );
  });

  test("a quotation the page never prints is unverified", () => {
    const r = verifyAgainstSource('They now say "the fastest way to scale".', "The fastest way to ship");
    expect(texts(r)).toEqual(["the fastest way to scale"]);
  });

  test("a short quoted label is a label, not a claim, and is skipped", () => {
    expect(verifyAgainstSource('The "Pro" tier moved.', "Enterprise and Team plans").verified).toBe(
      true,
    );
  });
});

describe("verifyFieldsAgainstSource", () => {
  test("stamps the field an unsupported figure came from", () => {
    const r = verifyFieldsAgainstSource(
      [
        { field: "insight", text: "They cut the Pro plan to $99." },
        { field: "so_what", text: "That is 41% below our own price." },
      ],
      "Pro plan is now $99 per month",
    );
    expect(r.verified).toBe(false);
    expect(r.unverified).toEqual([{ kind: "percentage", text: "41%", field: "so_what" }]);
  });

  test("an empty or missing field is skipped, not flagged", () => {
    const r = verifyFieldsAgainstSource(
      [{ field: "insight", text: "" }, { field: "so_what", text: "No figures here." }],
      "",
    );
    expect(r).toEqual({ verified: true, unverified: [], checked: 0 });
  });
});

describe("locateSupportedTokens", () => {
  const SOURCE = "Starter — $19 / seat\nPro — $79 / seat / month\nEnterprise — talk to us";

  test("reports the figure the source carries, where it sits, and the line backing it", () => {
    const output = "Pro moved to $79 per seat, up 60%.";
    const found = locateSupportedTokens(output, SOURCE);
    expect(found.map((t) => t.text)).toEqual(["$79"]);
    const token = found[0]!;
    expect(token.kind).toBe("amount");
    expect(output.slice(token.start, token.end)).toBe("$79");
    expect(token.sourceLine).toBe("Pro — $79 / seat / month");
  });

  test("never reports a figure the source does not carry", () => {
    expect(locateSupportedTokens("They now charge $1,299.", SOURCE)).toEqual([]);
  });

  test("locates a quoted span and quotes its line back", () => {
    const source = "Plans\nSSO is now included in every paid plan\nFAQ";
    const found = locateSupportedTokens('They say "SSO is now included in every paid plan".', source);
    expect(found.map((t) => t.kind)).toEqual(["quoted"]);
    expect(found[0]!.sourceLine).toBe("SSO is now included in every paid plan");
  });

  test("a token is never both supported here and unverified there", () => {
    const output = "Pro is $79, up from $49.";
    const supported = locateSupportedTokens(output, SOURCE).map((t) => t.text);
    const unverified = verifyAgainstSource(output, SOURCE).unverified.map((t) => t.text);
    expect(supported).toEqual(["$79"]);
    expect(unverified).toEqual(["$49"]);
    expect(supported.some((t) => unverified.includes(t))).toBe(false);
  });

  test("offsets survive a figure the pattern reaches across a space", () => {
    const output = "Seats went up 19 percent.";
    const token = locateSupportedTokens(output, SOURCE)[0]!;
    expect(output.slice(token.start, token.end)).toBe("19");
  });

  test("returns nothing when either side is empty", () => {
    expect(locateSupportedTokens("", SOURCE)).toEqual([]);
    expect(locateSupportedTokens("Pro is $79", "")).toEqual([]);
  });
});
