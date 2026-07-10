import { describe, expect, test } from "bun:test";
import {
  evaluateFirstSignalAlerts,
  type FirstSignalSloInputs,
} from "../src/lib/slo-first-signal";

// The SLO doc's event-based alert table (docs/slos/onboarding-first-signal.md):
// low-traffic guards matter more than the thresholds — a single miss or a tiny
// sample must never page.

function inputs(over: Partial<FirstSignalSloInputs> = {}): FirstSignalSloInputs {
  return {
    recent: [true, true, true],
    week: { completions: 0, within: 0 },
    window: { completions: 0, within: 0 },
    coverage24h: { completions: 0, within: 0 },
    ...over,
  };
}

describe("evaluateFirstSignalAlerts", () => {
  test("all healthy → no alerts", () => {
    const out = evaluateFirstSignalAlerts(
      inputs({
        week: { completions: 7, within: 6 },
        window: { completions: 25, within: 20 },
      }),
    );
    expect(out).toEqual([]);
  });

  test("3 consecutive misses page; 2 do not", () => {
    expect(
      evaluateFirstSignalAlerts(inputs({ recent: [false, false, false] })).some((a) =>
        a.includes("🚨"),
      ),
    ).toBe(true);
    expect(evaluateFirstSignalAlerts(inputs({ recent: [false, false, true] }))).toEqual([]);
    // Fewer than 3 elapsed completions can never page (cold start).
    expect(evaluateFirstSignalAlerts(inputs({ recent: [false, false] }))).toEqual([]);
  });

  test("7d degradation needs the minimum sample", () => {
    // 4 completions, all missed → still silence (min sample is 5).
    expect(
      evaluateFirstSignalAlerts(inputs({ week: { completions: 4, within: 0 } })),
    ).toEqual([]);
    const out = evaluateFirstSignalAlerts(inputs({ week: { completions: 5, within: 2 } }));
    expect(out.some((a) => a.includes("degrading"))).toBe(true);
    // 50% exactly is NOT below the 50% line.
    expect(
      evaluateFirstSignalAlerts(inputs({ week: { completions: 6, within: 3 } })),
    ).toEqual([]);
  });

  test("28d budget exhaustion needs 10 completions and < 70%", () => {
    expect(
      evaluateFirstSignalAlerts(inputs({ window: { completions: 9, within: 0 } })),
    ).toEqual([]);
    const out = evaluateFirstSignalAlerts(inputs({ window: { completions: 10, within: 6 } }));
    expect(out.some((a) => a.includes("budget exhausted"))).toBe(true);
    expect(
      evaluateFirstSignalAlerts(inputs({ window: { completions: 10, within: 7 } })),
    ).toEqual([]);
  });
});
