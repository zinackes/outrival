import { describe, expect, test } from "bun:test";
import { capDigestSignals, DIGEST_MAX_SIGNALS, type DigestInputSignal } from "./digest";

function sig(severity: DigestInputSignal["severity"], n: number): DigestInputSignal {
  return {
    competitor: `Comp ${n}`,
    category: "product",
    severity,
    insight: `insight ${n}`,
    so_what: null,
  };
}

describe("capDigestSignals", () => {
  test("under the cap passes through untouched", () => {
    const signals = [sig("low", 1), sig("high", 2)];
    const { kept, omitted } = capDigestSignals(signals);
    expect(kept).toBe(signals);
    expect(omitted).toBe(0);
  });

  test("over the cap keeps the highest severities and counts the rest", () => {
    // 10 critical + 30 low → the 10 critical must all survive; only 20 low fit.
    const signals = [
      ...Array.from({ length: 30 }, (_, i) => sig("low", i)),
      ...Array.from({ length: 10 }, (_, i) => sig("critical", 100 + i)),
    ];
    const { kept, omitted } = capDigestSignals(signals);
    expect(kept.length).toBe(DIGEST_MAX_SIGNALS);
    expect(omitted).toBe(10);
    expect(kept.filter((s) => s.severity === "critical").length).toBe(10);
    expect(kept.filter((s) => s.severity === "low").length).toBe(20);
  });

  test("kept signals preserve their original relative order", () => {
    const signals = [sig("low", 1), sig("critical", 2), sig("medium", 3)];
    // Force the cap path with padding beyond the limit.
    const padded = [...signals, ...Array.from({ length: DIGEST_MAX_SIGNALS }, (_, i) => sig("high", 10 + i))];
    const { kept } = capDigestSignals(padded);
    const indexOf = (n: number) => kept.findIndex((s) => s.insight === `insight ${n}`);
    // The low and medium are dropped; the surviving critical keeps its place
    // AHEAD of the later highs (original input order, not severity order).
    expect(indexOf(2)).toBe(0);
    expect(indexOf(1)).toBe(-1);
    expect(indexOf(3)).toBe(-1);
  });

  test("it returns the very objects it was given, extra fields and all", () => {
    // The API's "in progress" view needs to know WHICH moves survive the cap, and it
    // gets that by tagging its rows with an id before ranking them. That only works
    // because this function selects objects rather than rebuilding them — a refactor
    // that maps to fresh literals would silently drop the tag and mark every move as
    // making the brief.
    const tagged = Array.from({ length: DIGEST_MAX_SIGNALS + 5 }, (_, i) => ({
      ...sig(i < 3 ? "critical" : "low", i),
      id: `sig-${i}`,
    }));
    const { kept, omitted } = capDigestSignals(tagged);
    expect(omitted).toBe(5);
    expect(kept.length).toBe(DIGEST_MAX_SIGNALS);
    // Identity, not just shape: every kept entry is one of the inputs.
    for (const k of kept) expect(tagged).toContain(k as (typeof tagged)[number]);
    const keptIds = new Set(kept.map((k) => (k as (typeof tagged)[number]).id));
    expect(keptIds.size).toBe(DIGEST_MAX_SIGNALS);
    // The three criticals outrank the lows, so they cannot be the ones dropped.
    for (const id of ["sig-0", "sig-1", "sig-2"]) expect(keptIds.has(id)).toBe(true);
  });
});
