import { describe, expect, it } from "bun:test";
import {
  normalizeDepartment,
  bucketJobCounts,
  isoWeekStart,
} from "../departments";

describe("normalizeDepartment — deterministic label map", () => {
  it("maps R&D, Technology and Engineering onto the same engineering bucket", () => {
    expect(normalizeDepartment("R&D", null, "Backend Engineer")).toBe("engineering");
    expect(normalizeDepartment("Technology", null, "Backend Engineer")).toBe("engineering");
    expect(normalizeDepartment("Engineering", null, "Backend Engineer")).toBe("engineering");
  });

  it("keeps data/ML distinct from generic engineering", () => {
    expect(normalizeDepartment("Data Science", null, "")).toBe("data_ml");
    // Title contains "Engineer" but the ML qualifier must win (rule ordering).
    expect(normalizeDepartment("", null, "Machine Learning Engineer")).toBe("data_ml");
  });

  it("disambiguates product compounds", () => {
    expect(normalizeDepartment("", null, "Product Designer")).toBe("design");
    expect(normalizeDepartment("", null, "Product Marketing Manager")).toBe("marketing");
    expect(normalizeDepartment("Product", null, "Senior Product Manager")).toBe("product");
  });

  it("routes customer support to customer_success, not ops", () => {
    expect(normalizeDepartment("Customer Support", null, "")).toBe("customer_success");
    expect(normalizeDepartment("", null, "Customer Success Manager")).toBe("customer_success");
  });

  it("sends sales/GTM titles to sales even when they read 'Engineer'", () => {
    expect(normalizeDepartment("", null, "Sales Engineer")).toBe("sales");
    expect(normalizeDepartment("Revenue", null, "Account Executive")).toBe("sales");
  });
});

describe("normalizeDepartment — title fallback", () => {
  it("falls back to the title when the department field is empty", () => {
    // Lever frequently leaves `department` blank — the title carries the signal.
    expect(normalizeDepartment("", "", "Senior Backend Engineer")).toBe("engineering");
    expect(normalizeDepartment(null, null, "Growth Marketer")).toBe("marketing");
  });

  it("prefers team over an empty department", () => {
    expect(normalizeDepartment("", "Engineering", "Generalist")).toBe("engineering");
  });

  it("returns unknown when nothing matches — never guessed", () => {
    expect(normalizeDepartment("Mystery", null, "Wizard")).toBe("unknown");
    expect(normalizeDepartment("", "", "")).toBe("unknown");
  });
});

describe("bucketJobCounts", () => {
  it("counts postings per bucket deterministically (idempotent aggregation)", () => {
    const jobs = [
      { department: "Engineering", title: "Backend Engineer" },
      { department: "R&D", title: "Frontend Engineer" },
      { department: "Sales", title: "Account Executive" },
      { department: "Mystery", title: "Wizard" },
    ];
    const a = bucketJobCounts(jobs);
    const b = bucketJobCounts(jobs);
    expect(a.get("engineering")).toBe(2);
    expect(a.get("sales")).toBe(1);
    expect(a.get("unknown")).toBe(1);
    // Same input → same aggregation (feeds the weekly upsert's idempotency key).
    expect(Array.from(a.entries()).sort()).toEqual(Array.from(b.entries()).sort());
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday (UTC) of the week for any day in it", () => {
    // 2026-07-13 is a Monday; the whole week maps to it.
    expect(isoWeekStart(new Date("2026-07-13T10:00:00Z"))).toBe("2026-07-13");
    expect(isoWeekStart(new Date("2026-07-15T23:00:00Z"))).toBe("2026-07-13");
    expect(isoWeekStart(new Date("2026-07-19T23:59:00Z"))).toBe("2026-07-13"); // Sunday
    expect(isoWeekStart(new Date("2026-07-20T00:00:00Z"))).toBe("2026-07-20"); // next Monday
  });
});
