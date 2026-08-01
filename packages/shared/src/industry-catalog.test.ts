import { test, expect, describe } from "bun:test";
import {
  resolveIndustry,
  resolveUserIndustry,
  normalizeIndustryLabel,
  industryLabel,
  CANONICAL_INDUSTRY_SLUGS,
} from "./industry-catalog";
import { normalizeCustomerName, displayCustomerName } from "./customer-name";

describe("resolveIndustry", () => {
  test("collapses EN / FR / DE wordings of one market onto one slug", () => {
    for (const label of [
      "fintech",
      "payments company",
      "banque régionale",
      "Zahlungsdienstleister",
      "financial services",
    ]) {
      expect(resolveIndustry(label)).toEqual({ slug: "fintech", isCanonical: true });
    }
    for (const label of ["healthcare", "hôpital public", "Krankenhaus", "medical practice"]) {
      expect(resolveIndustry(label).slug).toBe("healthcare");
    }
  });

  test("specific beats broad where vocabularies overlap", () => {
    // These would all match a naive "finance"/"health"/"software" pattern.
    expect(resolveIndustry("insurance broker").slug).toBe("insurance");
    expect(resolveIndustry("crypto exchange").slug).toBe("crypto_web3");
    expect(resolveIndustry("pharma manufacturer").slug).toBe("biotech_pharma");
    expect(resolveIndustry("recruiting agency").slug).toBe("hr_tech");
  });

  test("an unknown market is stored, slugified, and NOT canonical", () => {
    const resolved = resolveIndustry("Quantum computing research");
    expect(resolved).toEqual({ slug: "quantum_computing_research", isCanonical: false });
    expect(CANONICAL_INDUSTRY_SLUGS.has(resolved.slug)).toBe(false);
  });

  test("empty / whitespace resolves to unknown rather than throwing", () => {
    expect(resolveIndustry("   ")).toEqual({ slug: "unknown", isCanonical: false });
  });

  test("normalization strips diacritics and collapses whitespace", () => {
    expect(normalizeIndustryLabel("  Santé   PUBLIQUE ")).toBe("sante publique");
  });
});

describe("resolveUserIndustry", () => {
  // The rule the HIGH severity rests on: the reader's market is who they SELL TO.
  test("audience is read before category", () => {
    expect(
      resolveUserIndustry({ audience: "insurance brokers", category: "CRM software" }),
    ).toBe("insurance");
  });

  test("falls back to category when the audience names no market", () => {
    expect(resolveUserIndustry({ audience: "small teams", category: "edtech platform" })).toBe(
      "edtech",
    );
  });

  test("returns null when neither field names a market the catalog knows", () => {
    expect(resolveUserIndustry({ audience: "small teams", category: "project management" })).toBe(
      null,
    );
    expect(resolveUserIndustry({ audience: null, category: null })).toBe(null);
    // A free-text match is NOT a market: it would match nothing but its own wording.
    expect(resolveUserIndustry({ audience: "quantum labs", category: "" })).toBe(null);
  });
});

describe("industryLabel", () => {
  test("renders the awkward slugs as people write them", () => {
    expect(industryLabel("hr_tech")).toBe("HR tech");
    expect(industryLabel("saas")).toBe("SaaS");
    expect(industryLabel("real_estate")).toBe("real estate");
    expect(industryLabel("quantum_computing")).toBe("quantum computing");
  });
});

describe("normalizeCustomerName", () => {
  test("the same customer written three ways is one registry key", () => {
    const key = normalizeCustomerName("Acme");
    expect(normalizeCustomerName("Acme Inc.")).toBe(key);
    expect(normalizeCustomerName("ACME, LLC")).toBe(key);
    expect(normalizeCustomerName("  Acme   GmbH ")).toBe(key);
  });

  test("a legal form is only stripped where a legal form goes", () => {
    // "SAS Institute" is a company whose name starts with a legal-form token.
    expect(normalizeCustomerName("SAS Institute")).toBe("sas institute");
    expect(normalizeCustomerName("Acme SAS")).toBe("acme");
  });

  test("conservative: two different customers never merge", () => {
    expect(normalizeCustomerName("Data Inc")).not.toBe(normalizeCustomerName("Datainc"));
    expect(normalizeCustomerName("Acme Health")).not.toBe(normalizeCustomerName("Acme"));
  });

  test("a name that IS its legal form keeps a key rather than becoming empty", () => {
    expect(normalizeCustomerName("GmbH")).toBe("gmbh");
  });

  test("display keeps the page's own casing, drops trailing punctuation", () => {
    expect(displayCustomerName("  ACME Corp. ")).toBe("ACME Corp");
    expect(displayCustomerName("Acme —")).toBe("Acme");
  });
});
