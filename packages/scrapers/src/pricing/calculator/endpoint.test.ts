import { describe, expect, it } from "bun:test";
import { findPricePath, readPricePath, type CapturedJson } from "./endpoint";

const call = (url: string, body: unknown): CapturedJson => ({ url, body });

describe("findPricePath", () => {
  it("anchors on the number the page displayed, not on the first number it finds", () => {
    const calls = [
      call("https://x.test/api/estimate?qty=100000", {
        quantity: 100000,
        rate: 0.002,
        data: { estimate: { monthlyTotal: 200, annualTotal: 2400 } },
      }),
    ];
    const hit = findPricePath(calls, 200);
    expect(hit?.pathname).toBe("/api/estimate");
    expect(hit?.path).toBe("data.estimate.monthlyTotal");
    // The exact request is kept too — it is what a replay is built from.
    expect(hit?.url).toBe("https://x.test/api/estimate?qty=100000");
    expect(hit?.method).toBe("GET");
  });

  it("accepts a total serialised as a string", () => {
    const hit = findPricePath([call("https://x.test/p", { total: "199.99" })], 199.99);
    expect(hit?.path).toBe("total");
  });

  it("tolerates the rounding a page applies for display", () => {
    const hit = findPricePath([call("https://x.test/p", { total: 1234.5601 })], 1234.56);
    expect(hit?.path).toBe("total");
  });

  it("returns null when no leaf matches the displayed total", () => {
    expect(findPricePath([call("https://x.test/p", { total: 42 })], 200)).toBeNull();
  });

  it("returns null when there was no JSON at all — the UI path stays in charge", () => {
    expect(findPricePath([], 200)).toBeNull();
  });
});

describe("readPricePath", () => {
  const target = { pathname: "/api/estimate", path: "data.total" };

  it("reads the same path out of a later response, ignoring the query string", () => {
    const calls = [
      call("https://x.test/api/estimate?qty=1000", { data: { total: 20 } }),
      call("https://x.test/api/estimate?qty=100000", { data: { total: 200 } }),
    ];
    expect(readPricePath(calls, target)).toBe(200);
  });

  it("ignores responses from a different endpoint", () => {
    expect(readPricePath([call("https://x.test/api/other", { data: { total: 9 } })], target)).toBeNull();
  });

  it("returns null when the shape changed under us", () => {
    expect(readPricePath([call("https://x.test/api/estimate", { data: {} })], target)).toBeNull();
  });
});
