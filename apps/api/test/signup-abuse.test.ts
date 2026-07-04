import { describe, expect, test } from "bun:test";
import { localPartLooksRandom } from "../src/lib/signup-abuse";

describe("localPartLooksRandom", () => {
  test("flags digit-heavy and vowel-starved local parts", () => {
    expect(localPartLooksRandom("7x2k9p4q1z")).toBe(true); // 5/10 digits > 0.4
    expect(localPartLooksRandom("xkgbqrtnwz")).toBe(true); // long, no vowels
  });

  test("passes ordinary human and role addresses", () => {
    expect(localPartLooksRandom("mathys")).toBe(false);
    expect(localPartLooksRandom("john.doe")).toBe(false);
    expect(localPartLooksRandom("first.last")).toBe(false);
    expect(localPartLooksRandom("sales")).toBe(false);
    expect(localPartLooksRandom("marie-claire")).toBe(false);
  });

  test("ignores the +tag when judging", () => {
    expect(localPartLooksRandom("john+x7k2p9qab3z9")).toBe(false);
  });

  test("does not flag short strings even if odd", () => {
    expect(localPartLooksRandom("xkzq")).toBe(false);
  });
});
