import { describe, expect, test } from "bun:test";
import {
  normalizeCompetitorUrl,
  validateCompetitorForm,
} from "@/lib/competitor-form";

// The add-competitor dialog used to delegate to the browser (`required`,
// `type="url"`), whose refusal is invisible inside a Radix dialog: no message, no
// request, nothing (`ux:04`). These lock the rules that replaced it — including the
// one the browser got wrong, a schemeless host, which is now accepted and
// normalised rather than silently rejected.

describe("normalizeCompetitorUrl", () => {
  test("adds the scheme people leave out", () => {
    expect(normalizeCompetitorUrl("example.com")).toBe("https://example.com/");
    expect(normalizeCompetitorUrl("  example.com/pricing  ")).toBe(
      "https://example.com/pricing",
    );
  });

  test("keeps an explicit http(s) scheme", () => {
    expect(normalizeCompetitorUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeCompetitorUrl("https://Example.COM/x")).toBe("https://example.com/x");
  });

  test("rejects what can't be a competitor's site", () => {
    for (const bad of [
      "",
      "   ",
      "not a url",
      "javascript:alert(1)",
      "ftp://example.com",
      "https://user:pw@example.com",
      "localhost",
      "https://intranet",
      "https://example.com.",
    ]) {
      expect(normalizeCompetitorUrl(bad)).toBeNull();
    }
  });
});

describe("validateCompetitorForm", () => {
  test("an empty submit names both fields instead of doing nothing", () => {
    const { errors, values } = validateCompetitorForm({ name: "", url: "" });
    expect(values).toBeUndefined();
    expect(errors.name).toBeTruthy();
    expect(errors.url).toBeTruthy();
  });

  test("whitespace is not a name", () => {
    expect(validateCompetitorForm({ name: "   ", url: "example.com" }).errors.name)
      .toBeTruthy();
  });

  test("a name over the API's limit is caught before the request", () => {
    const { errors } = validateCompetitorForm({
      name: "a".repeat(61),
      url: "example.com",
    });
    expect(errors.name).toContain("60");
  });

  test("an unparseable URL is reported on the URL field alone", () => {
    const { errors, values } = validateCompetitorForm({ name: "Acme", url: "??" });
    expect(values).toBeUndefined();
    expect(errors.name).toBeUndefined();
    expect(errors.url).toBeTruthy();
  });

  test("a valid pair returns the trimmed, normalised payload", () => {
    expect(validateCompetitorForm({ name: "  Acme  ", url: "acme.com" })).toEqual({
      errors: {},
      values: { name: "Acme", url: "https://acme.com/" },
    });
  });
});
