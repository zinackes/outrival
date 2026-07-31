import { test, expect, describe } from "bun:test";
import { diffCreditBurns, type CreditBurnRow } from "./credit-burn-diff";

const burn = (action: string, credits: number): CreditBurnRow => ({ action, credits });

describe("diffCreditBurns", () => {
  test("a rise in what an action spends reads high — the price rise nobody printed", () => {
    const changes = diffCreditBurns([burn("OCR", 5)], [burn("OCR", 8)]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("credit_burn_changed");
    expect(changes[0]!.severity).toBe("high");
    expect(changes[0]!.direction).toBe("up");
    expect(changes[0]!.pctChange).toBe(60);
    expect(changes[0]!.humanBefore).toBe("OCR — 5 credits");
    expect(changes[0]!.humanAfter).toBe("OCR — 8 credits");
    expect(changes[0]!.summary).toContain("5 credits → 8 credits");
  });

  test("a drop reads medium, not high", () => {
    const changes = diffCreditBurns([burn("Deep scan", 10)], [burn("Deep scan", 4)]);
    expect(changes[0]!.severity).toBe("medium");
    expect(changes[0]!.direction).toBe("down");
    expect(changes[0]!.pctChange).toBe(-60);
  });

  test("one credit is singular", () => {
    const changes = diffCreditBurns([burn("Scan", 2)], [burn("Scan", 1)]);
    expect(changes[0]!.humanAfter).toBe("Scan — 1 credit");
  });

  test("an added or removed action is low, never a rate change", () => {
    const changes = diffCreditBurns(
      [burn("OCR", 5), burn("Export", 1)],
      [burn("OCR", 5), burn("Translate", 3)],
    );
    const byType = new Map(changes.map((c) => [c.type, c]));
    expect(changes).toHaveLength(2);
    expect(byType.get("credit_action_added")!.severity).toBe("low");
    expect(byType.get("credit_action_added")!.humanAfter).toBe("Translate — 3 credits");
    expect(byType.get("credit_action_removed")!.severity).toBe("low");
    expect(byType.get("credit_action_removed")!.humanBefore).toBe("Export — 1 credit");
  });

  test("wording that only differs in case or spacing is the same action", () => {
    expect(diffCreditBurns([burn("OCR  page", 5)], [burn("ocr page", 5)])).toEqual([]);
  });

  test("an unchanged mapping is silent", () => {
    const rows = [burn("OCR", 5), burn("Export", 1)];
    expect(diffCreditBurns(rows, rows)).toEqual([]);
  });

  test("an empty side is never read as a wholesale removal", () => {
    expect(diffCreditBurns([], [burn("OCR", 5)])).toEqual([]);
    expect(diffCreditBurns([burn("OCR", 5)], [])).toEqual([]);
  });

  test("the unit is the credit, so the change carries a meter", () => {
    const [change] = diffCreditBurns([burn("OCR", 5)], [burn("OCR", 6)]);
    expect(change!.unit).toBe("credit");
    expect(change!.planName).toBeNull();
  });
});
