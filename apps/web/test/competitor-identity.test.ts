import { describe, expect, test } from "bun:test";
import {
  competitorFallbackColor,
  competitorInitials,
} from "../src/lib/competitor-identity";
import { SERIES_TOKENS } from "../src/lib/competitor-color";

describe("competitorInitials", () => {
  test("a single-word name gives its first two letters", () => {
    expect(competitorInitials("Cloudsmith")).toBe("CL");
    expect(competitorInitials("Codeium")).toBe("CO");
  });

  test("a multi-word name gives one letter per word", () => {
    expect(competitorInitials("Azure Artifacts")).toBe("AA");
    expect(competitorInitials("AWS CodeArtifact")).toBe("AC");
  });

  test("the reported collisions no longer draw the same tile", () => {
    // "C" was Cloudsmith, Codeium and Cosyra; "A" was both Azure Artifacts and
    // AWS CodeArtifact (OUT-179). Codeium and Cosyra still share "CO" — the
    // fallback hue is what separates that pair.
    expect(competitorInitials("Cloudsmith")).not.toBe(competitorInitials("Codeium"));
    expect(competitorInitials("Azure Artifacts")).not.toBe(
      competitorInitials("AWS CodeArtifact"),
    );
  });

  test("a camelCase brand counts as two words", () => {
    expect(competitorInitials("CodeArtifact")).toBe("CA");
    expect(competitorInitials("npmJS")).toBe("NJ");
  });

  test("punctuation and extra whitespace are not letters", () => {
    expect(competitorInitials("  Sonatype   Nexus ")).toBe("SN");
    expect(competitorInitials("C++ Corp.")).toBe("CC");
    expect(competitorInitials("JFrog-Artifactory")).toBe("JA");
  });

  test("a leading digit is kept — it is what the reader sees", () => {
    expect(competitorInitials("1Password")).toBe("1P");
  });

  test("a name with no letters at all never renders an empty tile", () => {
    expect(competitorInitials("   ")).toBe("?");
    expect(competitorInitials("---")).toBe("?");
  });
});

describe("competitorFallbackColor", () => {
  test("always resolves to a palette token", () => {
    for (const name of ["Cloudsmith", "Codeium", "Cosyra", "", "1Password"]) {
      expect(SERIES_TOKENS).toContain(competitorFallbackColor(name));
    }
  });

  test("is stable for the same name", () => {
    expect(competitorFallbackColor("Cloudsmith")).toBe(
      competitorFallbackColor("Cloudsmith"),
    );
  });

  test("separates the pair the initials cannot", () => {
    expect(competitorFallbackColor("Codeium")).not.toBe(
      competitorFallbackColor("Cosyra"),
    );
  });
});
