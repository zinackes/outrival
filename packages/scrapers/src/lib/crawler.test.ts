import { test, expect } from "bun:test";
import { scrapeFirstSuccess, ScrapeFailedError } from "./crawler";
import type { ScrapeOutcome } from "../types";

// scrapeFirstSuccess probes a list of guessed paths. The one thing it must not do is
// flatten WHY they failed: the collection doctrine turns on the difference between a
// site that refused us (stop, mark unscrapable) and one that merely 404'd (keep
// probing). Wrapping every candidate error in a fresh Error erased that, so
// linode.com/blog — a flat 403 from Akamai — was re-probed on every run instead of
// being marked once, and produced the second-loudest error in production.

function outcome(text: string, statusCode = 200): ScrapeOutcome {
  return {
    html: `<html><body>${text}</body></html>`,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url: "https://acme.com/blog" },
    statusCode,
    level: 0,
    attempts: 1,
  };
}

function refusal(reason: string): ScrapeFailedError {
  return new ScrapeFailedError(reason, {
    ok: false,
    refused: true,
    failureReason: reason,
    durationMs: 0,
    level: null,
    learnedLevel: null,
    attempts: [],
    totalDurationMs: 0,
  });
}

const LONG = "a real listing page ".repeat(10);

test("the first acceptable candidate wins", async () => {
  const seen: string[] = [];
  const res = await scrapeFirstSuccess("https://acme.com/", ["/blog", "/news"], async (u) => {
    seen.push(u);
    if (u.endsWith("/blog")) throw new Error("http_error");
    return outcome(LONG);
  });
  expect(res.text).toBe(LONG);
  expect(seen).toEqual(["https://acme.com/blog", "https://acme.com/news"]);
});

test("a refusal on any candidate is rethrown verbatim, refusal flag intact", async () => {
  const err = await scrapeFirstSuccess("https://acme.com/", ["/blog", "/news"], async (u) => {
    if (u.endsWith("/blog")) throw refusal("blocked_403");
    throw new Error("http_error");
  }).then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(ScrapeFailedError);
  expect((err as ScrapeFailedError).cascadeOutcome.refused).toBe(true);
  expect((err as ScrapeFailedError).cascadeOutcome.failureReason).toBe("blocked_403");
});

test("a refusal never pre-empts a candidate that actually worked", async () => {
  const res = await scrapeFirstSuccess("https://acme.com/", ["/blog", "/news"], async (u) => {
    if (u.endsWith("/blog")) throw refusal("cloudflare_challenge");
    return outcome(LONG);
  });
  expect(res.text).toBe(LONG);
});

test("plain failures still collapse into the aggregate error", async () => {
  await expect(
    scrapeFirstSuccess("https://acme.com/", ["/blog", "/news"], async () => {
      throw new Error("http_error");
    }),
  ).rejects.toThrow("No candidate path succeeded for https://acme.com/");
});
