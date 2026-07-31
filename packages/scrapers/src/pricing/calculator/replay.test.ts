import { describe, expect, it } from "bun:test";
import { planReplay, replayUrl, replayEvidence } from "./replay";
import type { PricePath } from "./endpoint";

const price = (over: Partial<PricePath> = {}): PricePath => ({
  pathname: "/api/estimate",
  path: "data.total",
  url: "https://acme.test/api/estimate?qty=10000&plan=pro",
  method: "GET",
  requestHeaders: {},
  ...over,
});

const PAGE = "https://acme.test/pricing";

describe("planReplay", () => {
  it("identifies the query parameter that carries the quantity", () => {
    const out = planReplay(price(), PAGE, 10_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.qtyParam).toBe("qty");
    expect(out.plan.path).toBe("data.total");
  });

  it("reads a formatted quantity as the same number", () => {
    const out = planReplay(
      price({ url: "https://acme.test/api/estimate?units=10%2C000" }),
      PAGE,
      10_000,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.qtyParam).toBe("units");
  });

  it("refuses a POST — a body we did not understand is not one we repeat", () => {
    const out = planReplay(price({ method: "POST" }), PAGE, 10_000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not_get");
  });

  it("refuses a credentialed request rather than re-signing it", () => {
    const out = planReplay(price({ requestHeaders: { authorization: "Bearer x" } }), PAGE, 10_000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("authorized_request");
  });

  it("refuses an endpoint on another host", () => {
    const out = planReplay(
      price({ url: "https://pricing-api.vendor.test/estimate?qty=10000" }),
      PAGE,
      10_000,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("cross_origin");
  });

  it("refuses when the quantity isn't in the query — we'd be guessing which knob to turn", () => {
    const out = planReplay(price({ url: "https://acme.test/api/estimate?plan=pro" }), PAGE, 10_000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("qty_not_in_query");
  });

  it("does not mistake another number for the quantity", () => {
    // `plan=10000` is not the volume we set; only the parameter equal to the
    // anchor quantity identifies the knob.
    const out = planReplay(
      price({ url: "https://acme.test/api/estimate?plan=10000&qty=500" }),
      PAGE,
      500,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan.qtyParam).toBe("qty");
  });
});

describe("replayUrl", () => {
  it("changes the quantity and nothing else", () => {
    const out = planReplay(price(), PAGE, 10_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const url = new URL(replayUrl(out.plan, 1_000_000));
    expect(url.searchParams.get("qty")).toBe("1000000");
    expect(url.searchParams.get("plan")).toBe("pro");
    expect(url.origin + url.pathname).toBe("https://acme.test/api/estimate");
  });
});

describe("replayEvidence", () => {
  it("keeps the request, the answer, and what it was confirmed against", () => {
    const json = JSON.parse(
      replayEvidence({
        url: "https://acme.test/api/estimate?qty=100000",
        qty: 100_000,
        path: "data.total",
        amount: 200,
        currency: "USD",
        body: { data: { total: 200 } },
        confirmedAgainst: { qty: 10_000, amount: 25 },
      }),
    );
    expect(json.kind).toBe("api_response");
    expect(json.request.url).toContain("qty=100000");
    expect(json.readAt).toBe("data.total");
    expect(json.amount).toBe(200);
    expect(json.confirmedAgainst).toEqual({ qty: 10_000, amount: 25 });
    expect(json.response).toEqual({ data: { total: 200 } });
  });
});
