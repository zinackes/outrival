import { describe, expect, test } from "bun:test";
import {
  filterRelevantApiCalls,
  apiCallsToHtmlDoc,
  apiCallsToText,
  toEndpoints,
  type CapturedApiCall,
} from "../filter";

function call(over: Partial<CapturedApiCall>): CapturedApiCall {
  const body = over.body ?? null;
  return {
    url: "https://api.example.com/x",
    method: "GET",
    status: 200,
    contentType: "application/json",
    body,
    rawText: typeof body === "object" ? JSON.stringify(body) : (over.rawText ?? ""),
    ...over,
  };
}

const contentful = call({
  url: "https://api.example.com/v1/products",
  body: { products: [{ id: 1, name: "Plan A" }, { id: 2, name: "Plan B" }], total: 2, extra: "x".repeat(300) },
});

describe("filterRelevantApiCalls", () => {
  test("keeps a JSON call with content-like keys", () => {
    expect(filterRelevantApiCalls([contentful])).toHaveLength(1);
  });

  test("drops auth/analytics endpoints", () => {
    const noise = call({ url: "https://api.example.com/auth/token", body: { data: "x".repeat(300) } });
    expect(filterRelevantApiCalls([noise])).toHaveLength(0);
  });

  test("drops bodies that are too short", () => {
    const tiny = call({ body: { content: "ok" } });
    expect(filterRelevantApiCalls([tiny])).toHaveLength(0);
  });

  test("drops calls whose JSON has no content-like keys", () => {
    const irrelevant = call({ body: { sessionId: "abc", token: "x".repeat(300) } });
    expect(filterRelevantApiCalls([irrelevant])).toHaveLength(0);
  });
});

describe("apiCallsToHtmlDoc", () => {
  test("wraps content and escapes HTML", () => {
    const html = apiCallsToHtmlDoc([call({ body: { items: ["<b>", "x".repeat(300)] } })]);
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });

  test("empty content → empty doc", () => {
    expect(apiCallsToHtmlDoc([])).toBe("");
  });

  test("is deterministic regardless of key order", () => {
    const a = call({ url: "https://api.example.com/d", body: { content: 1, data: 2, items: "x".repeat(300) } });
    const b = call({ url: "https://api.example.com/d", body: { items: "x".repeat(300), data: 2, content: 1 } });
    expect(apiCallsToText([a])).toBe(apiCallsToText([b]));
  });
});

describe("toEndpoints", () => {
  test("dedupes by method + path, strips query", () => {
    const calls = [
      call({ url: "https://api.example.com/v1/products?page=1", body: { products: ["x".repeat(300)] } }),
      call({ url: "https://api.example.com/v1/products?page=2", body: { products: ["x".repeat(300)] } }),
    ];
    const eps = toEndpoints(calls);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.url).toBe("https://api.example.com/v1/products");
  });
});
