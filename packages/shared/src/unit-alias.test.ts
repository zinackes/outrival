import { test, expect, describe } from "bun:test";
import {
  normalizeUnitLabel,
  resolveMeterUnit,
  isCanonicalMeterUnit,
  meterUnitLabel,
  CANONICAL_METER_UNITS,
} from "./unit-alias";

const unitOf = (raw: string) => resolveMeterUnit(raw)?.unit;
const canonical = (raw: string) => resolveMeterUnit(raw)?.canonical;

describe("normalizeUnitLabel", () => {
  test("strips the framing a pricing page puts around a meter", () => {
    expect(normalizeUnitLabel("per API call")).toBe("api call");
    expect(normalizeUnitLabel("/GB")).toBe("gb");
    expect(normalizeUnitLabel("1,000 emails")).toBe("emails");
    expect(normalizeUnitLabel("10k requests")).toBe("requests");
    expect(normalizeUnitLabel("GB / month")).toBe("gb");
    expect(normalizeUnitLabel("seats per month")).toBe("seats");
  });

  test("strips diacritics so patterns can be written unaccented", () => {
    expect(normalizeUnitLabel("Crédit")).toBe("credit");
    expect(normalizeUnitLabel("événement")).toBe("evenement");
    expect(normalizeUnitLabel("par utilisateur")).toBe("utilisateur");
  });

  test("blank in, blank out", () => {
    expect(normalizeUnitLabel("   ")).toBe("");
    expect(normalizeUnitLabel("per ")).toBe("per");
  });
});

describe("resolveMeterUnit — one identity per meter", () => {
  test("data volume collapses across languages and spellings", () => {
    for (const raw of ["GB", "Go", "gigabytes", "giga-octets", "500 GB"]) {
      expect(unitOf(raw)).toBe("gb");
    }
    expect(unitOf("TB")).toBe("tb");
    expect(unitOf("To")).toBe("tb");
  });

  test("api surface collapses onto request", () => {
    for (const raw of ["request", "requests", "req", "API call", "api calls", "appels API", "call"]) {
      expect(unitOf(raw)).toBe("request");
    }
  });

  test("seats collapse across the words vendors use for a person", () => {
    for (const raw of ["seat", "user", "utilisateur", "member", "Nutzer", "usuario", "gebruikers"]) {
      expect(unitOf(raw)).toBe("seat");
    }
  });

  test("credits, tokens and events keep their own identity", () => {
    expect(unitOf("crédit")).toBe("credit");
    expect(unitOf("tokens")).toBe("token");
    expect(unitOf("événements")).toBe("event");
  });

  test("specific meters outrank the broad ones they sit inside", () => {
    // A tracked user is a meter; a seat is a subscription unit. Reading an MTU
    // price as a seat price is the comparison this ordering exists to stop.
    expect(unitOf("monthly tracked users")).toBe("tracked_user");
    expect(unitOf("MTU")).toBe("tracked_user");
    // A resolution is billed per outcome, the conversation around it is not.
    expect(unitOf("resolved conversation")).toBe("resolution");
    expect(unitOf("conversation")).toBe("conversation");
    // SMS and email are priced apart from generic messages.
    expect(unitOf("SMS")).toBe("sms");
    expect(unitOf("emails")).toBe("email");
    expect(unitOf("messages")).toBe("message");
  });

  test("every catalog slug resolves to itself", () => {
    for (const slug of CANONICAL_METER_UNITS) {
      const resolved = resolveMeterUnit(slug.replace(/_/g, " "));
      expect(resolved?.canonical).toBe(true);
    }
  });
});

describe("resolveMeterUnit — an unknown meter is never guessed", () => {
  test("keeps the page wording, flagged non-canonical", () => {
    const resolved = resolveMeterUnit("per widget frobnication");
    expect(resolved).toEqual({ unit: "widget frobnication", canonical: false });
    expect(isCanonicalMeterUnit(resolved!.unit)).toBe(false);
  });

  test("the absence of a unit is not a unit", () => {
    expect(resolveMeterUnit(null)).toBeNull();
    expect(resolveMeterUnit(undefined)).toBeNull();
    expect(resolveMeterUnit("")).toBeNull();
    expect(resolveMeterUnit("   ")).toBeNull();
  });
});

describe("meterUnitLabel", () => {
  test("reads singular or plural, and never pluralises an abbreviation", () => {
    expect(meterUnitLabel("request", 1)).toBe("request");
    expect(meterUnitLabel("request", 10000)).toBe("requests");
    expect(meterUnitLabel("gb", 500)).toBe("GB");
    expect(meterUnitLabel("sms", 2)).toBe("SMS");
  });

  test("an unknown unit reads exactly as stored", () => {
    expect(meterUnitLabel("widget frobnication", 3)).toBe("widget frobnication");
  });
});
