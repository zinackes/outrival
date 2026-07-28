import { describe, expect, it } from "bun:test";
import { COMPETITOR_NAME_MAX_LENGTH, deriveCompetitorName } from "./url";

describe("deriveCompetitorName", () => {
  it("keeps the brand ahead of a colon tagline", () => {
    expect(
      deriveCompetitorName(
        "https://postiz.com",
        "Postiz: The All-in-One agentic social media scheduling tool",
      ),
    ).toBe("Postiz");
  });

  it("finds the brand when the title trails with it", () => {
    expect(
      deriveCompetitorName("https://postiz.com", "The all-in-one scheduling tool | Postiz"),
    ).toBe("Postiz");
  });

  it("handles dash and pipe separators", () => {
    expect(deriveCompetitorName("https://linear.app", "Linear – Plan and build products")).toBe(
      "Linear",
    );
    expect(deriveCompetitorName("https://vercel.com", "Vercel - Build and deploy")).toBe("Vercel");
  });

  it("matches the brand across www, subdomains and multi-part TLDs", () => {
    expect(deriveCompetitorName("https://www.monzo.co.uk/personal", "Monzo | Banking made easy")) //
      .toBe("Monzo");
  });

  it("ignores punctuation when matching the domain label", () => {
    expect(
      deriveCompetitorName("https://e-conomic.dk", "Regnskabsprogram til alle | E-conomic"),
    ).toBe("E-conomic");
  });

  it("falls back to the domain label when every segment is a sentence", () => {
    const name = deriveCompetitorName(
      "https://postiz.com",
      "Everything your team needs to plan, schedule and publish social content in one place",
    );
    expect(name).toBe("Postiz");
  });

  it("falls back to the hostname without a title", () => {
    expect(deriveCompetitorName("https://www.postiz.com/pricing", null)).toBe("postiz.com");
    expect(deriveCompetitorName("https://postiz.com", "   ")).toBe("postiz.com");
  });

  it("never exceeds the max length", () => {
    const long = "x".repeat(200);
    expect(deriveCompetitorName("not a url", long).length).toBeLessThanOrEqual(
      COMPETITOR_NAME_MAX_LENGTH,
    );
  });
});
