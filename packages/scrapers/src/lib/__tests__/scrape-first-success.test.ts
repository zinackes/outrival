import { describe, expect, it } from "bun:test";
import { scrapeFirstSuccess } from "../crawler";
import type { ScrapeOutcome } from "../../types";

function outcome(partial: Partial<ScrapeOutcome>): ScrapeOutcome {
  return {
    html: "",
    text: "",
    screenshotBuffer: Buffer.alloc(0),
    metadata: {},
    level: 0,
    attempts: 1,
    ...partial,
  };
}

describe("scrapeFirstSuccess", () => {
  it("skips a 404 path with a full body and tries the next candidate", async () => {
    const seen: string[] = [];
    const res = await scrapeFirstSuccess("https://acme.fr", ["/careers", "/jobs"], async (u) => {
      seen.push(u);
      // ikxo.fr-style: /careers 404s with a big custom-404 / SPA-shell body.
      if (u.endsWith("/careers")) return outcome({ statusCode: 404, text: "x".repeat(2000) });
      return outcome({ statusCode: 200, text: "a real openings listing ".repeat(10) });
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(["https://acme.fr/careers", "https://acme.fr/jobs"]);
  });

  it("throws when every path 404s, even with non-empty bodies", async () => {
    await expect(
      scrapeFirstSuccess("https://acme.fr", ["/careers", "/jobs"], async () =>
        outcome({ statusCode: 404, text: "x".repeat(2000) }),
      ),
    ).rejects.toThrow();
  });

  it("returns a 200 page that has enough text", async () => {
    const res = await scrapeFirstSuccess("https://acme.fr", ["/careers"], async () =>
      outcome({ statusCode: 200, text: "y".repeat(100) }),
    );
    expect(res.text.length).toBe(100);
  });
});
