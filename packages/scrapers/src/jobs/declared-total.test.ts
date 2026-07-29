import { describe, expect, it } from "bun:test";
import { declaredOpenRoles } from "./signals";

describe("declaredOpenRoles", () => {
  it("reads the total a listing prints above its rows", () => {
    expect(declaredOpenRoles("Job Openings 56 jobs")).toBe(56);
    expect(declaredOpenRoles("We have 54 open positions")).toBe(54);
    expect(declaredOpenRoles("12 current openings")).toBe(12);
    expect(declaredOpenRoles("Nous avons 8 offres d'emploi")).toBe(8);
    expect(declaredOpenRoles("3 postes à pourvoir")).toBe(3);
  });

  it("takes the grand total, not a per-department count", () => {
    expect(declaredOpenRoles("56 jobs — Engineering: 14 roles, Sales: 7 roles")).toBe(56);
  });

  it("returns null when the page states no total", () => {
    expect(declaredOpenRoles("Join our team. Apply now.")).toBeNull();
    expect(declaredOpenRoles("")).toBeNull();
  });

  it("ignores numbers that are not a role count", () => {
    // A year, a headcount and a funding figure all sit on ordinary careers copy.
    expect(declaredOpenRoles("© 2026 Exotec — 1200 employees across 5 countries")).toBeNull();
    // Four digits is page furniture, never a board we could undercount.
    expect(declaredOpenRoles("1500 jobs created since 2015")).toBeNull();
  });

  it("treats zero openings as no shortfall to detect", () => {
    expect(declaredOpenRoles("0 open positions")).toBeNull();
  });
});
