import { describe, expect, it } from "bun:test";
import { pickTotal, parseTotal, readsAsYearly, type TotalCandidate } from "./readings";

const cand = (over: Partial<TotalCandidate> = {}): TotalCandidate => ({
  selector: ".total",
  before: "$25.00",
  after: "$80.00",
  childCount: 0,
  context: "Estimated monthly cost $80.00",
  ...over,
});

describe("parseTotal", () => {
  it("reads the amount and its currency", () => {
    expect(parseTotal("€1 299,00 / mo")).toEqual({ amount: 1299, currency: "EUR" });
  });

  it("refuses text with no price, and a zero total", () => {
    expect(parseTotal("Estimated cost")).toBeNull();
    expect(parseTotal("$0")).toBeNull();
  });
});

describe("readsAsYearly", () => {
  it("is true only when the wording says the figure is annual", () => {
    expect(readsAsYearly("$960 per year")).toBe(true);
    expect(readsAsYearly("$80/mo billed annually")).toBe(false);
    expect(readsAsYearly("Estimated monthly cost")).toBe(false);
  });
});

describe("pickTotal", () => {
  it("picks the element whose amount actually moved", () => {
    const out = pickTotal([
      cand({ selector: ".from", before: "from $10", after: "from $10" }),
      cand({ selector: ".total" }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.selector).toBe(".total");
    expect(out.amount).toBe(80);
    expect(out.currency).toBe("USD");
  });

  it("refuses when nothing priced changed — a dead control is not a reading", () => {
    const out = pickTotal([cand({ before: "$25.00", after: "$25.00" })]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no_total");
  });

  it("refuses an annual total rather than dividing it by twelve", () => {
    const out = pickTotal([
      cand({ before: "$300.00", after: "$960.00", context: "Estimated cost per year" }),
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("total_not_monthly");
  });

  it("prefers the leaf over the card that contains it", () => {
    const out = pickTotal([
      cand({ selector: ".card", childCount: 4, before: "Pro $25.00 /mo", after: "Pro $80.00 /mo" }),
      cand({ selector: ".amount", childCount: 0 }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.selector).toBe(".amount");
  });

  it("prefers the bill over the per-unit rate shown next to it", () => {
    const out = pickTotal([
      cand({ selector: ".rate", before: "$0.002", after: "$0.0018" }),
      cand({ selector: ".bill", before: "$25.00", after: "$80.00" }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.selector).toBe(".bill");
  });
});
