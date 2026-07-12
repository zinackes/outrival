import { describe, expect, test } from "bun:test";
import {
  summarizeFirstSignalSlo,
  FIRST_SIGNAL_SLO_TARGET,
  type FirstSignalSloInputs,
} from "./first-signal";

function inputs(over: Partial<FirstSignalSloInputs> = {}): FirstSignalSloInputs {
  return {
    recent: [true, true, true],
    week: { completions: 0, within: 0 },
    window: { completions: 0, within: 0 },
    coverage24h: { completions: 0, within: 0 },
    ...over,
  };
}

describe("summarizeFirstSignalSlo", () => {
  test("no completions → insufficient_data, null pct (never a fake 0%)", () => {
    const s = summarizeFirstSignalSlo(inputs());
    expect(s.status).toBe("insufficient_data");
    expect(s.window.pct).toBeNull();
    expect(s.week.pct).toBeNull();
  });

  test("28d sample below the 70% target → budget_exhausted", () => {
    const s = summarizeFirstSignalSlo(inputs({ window: { completions: 20, within: 5 } }));
    expect(s.status).toBe("budget_exhausted");
    expect(s.window.pct).toBeCloseTo(0.25, 5);
  });

  test("28d meets target but 7d below the degraded floor → degrading", () => {
    const s = summarizeFirstSignalSlo(
      inputs({
        window: { completions: 20, within: 16 }, // 80% — target met
        week: { completions: 6, within: 2 }, // 33% — degrading
      }),
    );
    expect(s.status).toBe("degrading");
  });

  test("healthy 28d sample at/above target → healthy", () => {
    const s = summarizeFirstSignalSlo(inputs({ window: { completions: 20, within: 15 } }));
    expect(s.status).toBe("healthy");
    expect(s.target).toBe(FIRST_SIGNAL_SLO_TARGET);
  });

  test("tiny 28d sample below target does NOT alarm (min-sample guard)", () => {
    const s = summarizeFirstSignalSlo(inputs({ window: { completions: 3, within: 0 } }));
    expect(s.status).toBe("insufficient_data");
  });

  test("last 3 onboardings all missed → recentAllMiss", () => {
    const s = summarizeFirstSignalSlo(inputs({ recent: [false, false, false] }));
    expect(s.recentAllMiss).toBe(true);
  });

  test("a single recent hit clears the all-miss flag", () => {
    const s = summarizeFirstSignalSlo(inputs({ recent: [true, false, false] }));
    expect(s.recentAllMiss).toBe(false);
  });
});
