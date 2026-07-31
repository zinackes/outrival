import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLocation } from "./resolve";
import { normalizeGeoKey, stripPlaceWrappers } from "./normalize";
import { GEO_DATASET_META } from "./dataset.generated";

/** `resolveLocation` collapsed to a comparable literal. */
function r(input: string | null | undefined): string {
  const out = resolveLocation(input);
  return out.countries.length > 0 ? out.countries.join("+") : out.resolution;
}

describe("normalizeGeoKey", () => {
  test("folds diacritics and irregular letters", () => {
    expect(normalizeGeoKey("München")).toBe("munchen");
    expect(normalizeGeoKey("København")).toBe("kobenhavn");
    expect(normalizeGeoKey("Genève")).toBe("geneve");
    expect(normalizeGeoKey("Łódź")).toBe("lodz");
    expect(normalizeGeoKey("Saint-Étienne")).toBe("saint etienne");
    expect(normalizeGeoKey("  S.F.  ")).toBe("s f");
  });

  test("returns empty for scripts the dataset cannot carry", () => {
    expect(normalizeGeoKey("東京")).toBe("");
    expect(normalizeGeoKey("Москва")).toBe("");
    expect(normalizeGeoKey("—")).toBe("");
  });

  test("strips metro-area decoration only as a second reading", () => {
    expect(stripPlaceWrappers("greater london area")).toBe("london");
    expect(stripPlaceWrappers("london")).toBeNull();
  });
});

describe("explicit countries", () => {
  test("English names and ISO codes", () => {
    expect(r("Germany")).toBe("DE");
    expect(r("United States")).toBe("US");
    expect(r("United Kingdom")).toBe("GB");
    expect(r("Netherlands")).toBe("NL");
  });

  test("localized labels (FR / DE / ES / IT / NL / PL / SV)", () => {
    expect(r("Allemagne")).toBe("DE");
    expect(r("Deutschland")).toBe("DE");
    expect(r("Alemania")).toBe("DE");
    expect(r("Germania")).toBe("DE");
    expect(r("Duitsland")).toBe("DE");
    expect(r("Niemcy")).toBe("DE");
    expect(r("Tyskland")).toBe("DE");
    expect(r("Pays-Bas")).toBe("NL");
    expect(r("Espagne")).toBe("ES");
    expect(r("Suisse")).toBe("CH");
    expect(r("Schweiz")).toBe("CH");
  });

  test("shorthands and non-ISO constituent countries", () => {
    expect(r("USA")).toBe("US");
    expect(r("UK")).toBe("GB");
    expect(r("England")).toBe("GB");
    expect(r("Scotland")).toBe("GB");
    expect(r("Holland")).toBe("NL");
  });

  test("a multi-word country is read before the string is cut up", () => {
    expect(r("Bosnia and Herzegovina")).toBe("BA");
    expect(r("Trinidad and Tobago")).toBe("TT");
  });

  test("a country code is only honoured in caps", () => {
    expect(r("Amsterdam, NL")).toBe("NL");
    // "de", "in" and "la" are ordinary words in the languages these boards use, so
    // a lowercase two-letter token is never read as a country.
    expect(r("de")).toBe("unknown");
    expect(r("in")).toBe("unknown");
  });
});

describe("cities", () => {
  test("resolve through the country they sit in", () => {
    expect(r("Berlin")).toBe("DE");
    expect(r("Amsterdam")).toBe("NL");
    expect(r("Bengaluru")).toBe("IN");
    expect(r("Tel Aviv")).toBe("IL");
  });

  test("local spellings of big cities", () => {
    expect(r("München")).toBe("DE");
    expect(r("Köln")).toBe("DE");
    expect(r("Wien")).toBe("AT");
    expect(r("København")).toBe("DK");
    expect(r("Praha")).toBe("CZ");
    expect(r("Milano")).toBe("IT");
    expect(r("Bruxelles")).toBe("BE");
    expect(r("Warszawa")).toBe("PL");
    expect(r("Göteborg")).toBe("SE");
  });

  test("metro-area decoration", () => {
    expect(r("Greater London Area")).toBe("GB");
    expect(r("Greater Copenhagen")).toBe("DK");
  });
});

describe("homonyms", () => {
  test("a wide population gap decides", () => {
    expect(r("Paris")).toBe("FR"); // 2.1M vs Paris, Texas at 25k
    expect(r("London")).toBe("GB"); // 8.9M vs London, Ontario at 422k
    expect(r("Dublin")).toBe("IE");
    expect(r("Sydney")).toBe("AU");
  });

  test("a narrow gap is left undecided rather than guessed", () => {
    // Cambridge: England 146k, Ontario 130k, Massachusetts 110k. Nothing in the
    // string says which, so nothing is claimed.
    expect(r("Cambridge")).toBe("unknown");
  });

  test("a sibling part decides what population cannot", () => {
    expect(r("Cambridge, MA")).toBe("US");
    expect(r("Cambridge, UK")).toBe("GB");
    expect(r("Cambridge, Ontario")).toBe("CA");
  });

  test("an alternate name never displaces a real city", () => {
    // GeoNames lists "Monaco" among München's alternate names. It must stay Monaco.
    expect(r("Monaco")).toBe("MC");
  });
});

describe("country / subdivision collisions", () => {
  test("Georgia is read from the rest of the string, not from a fixed precedence", () => {
    expect(r("Atlanta, Georgia")).toBe("US");
    expect(r("Tbilisi, Georgia")).toBe("GE");
    // On its own it is genuinely both, so it is neither.
    expect(r("Georgia")).toBe("unknown");
  });

  test("two-letter codes that are both a country and a US state", () => {
    expect(r("Berlin, DE")).toBe("DE");
    expect(r("Wilmington, DE")).toBe("US");
    expect(r("San Francisco, CA")).toBe("US");
    expect(r("Toronto, CA")).toBe("CA");
    // Bare, it is a coin flip between California and Canada — so it is unknown.
    expect(r("CA")).toBe("unknown");
  });

  test("a country name that is also a US town", () => {
    expect(r("Lebanon, OH")).toBe("US");
    expect(r("Beirut, Lebanon")).toBe("LB");
  });

  test("contradicting parts fall back to the exact labels", () => {
    // Paris, Ontario is a real Canadian town, too small for the city dataset. The
    // city says France, the province says Canada; the province is the exact label.
    expect(r("Paris, Ontario")).toBe("CA");
    expect(r("Paris, Texas")).toBe("US");
  });

  test("full hierarchies", () => {
    expect(r("Austin, TX, United States")).toBe("US");
    expect(r("New York, NY, USA")).toBe("US");
    expect(r("Bengaluru, Karnataka, India")).toBe("IN");
    expect(r("Berlin, Berlin, Germany")).toBe("DE");
    expect(r("Vancouver, WA")).toBe("US");
    expect(r("Vancouver, BC")).toBe("CA");
  });
});

describe("regions", () => {
  test("never produce a country", () => {
    for (const token of ["EMEA", "APAC", "LATAM", "DACH", "Benelux", "Nordics", "EU"]) {
      const out = resolveLocation(token);
      expect(out.resolution).toBe("region");
      expect(out.countries).toEqual([]);
    }
  });

  test("a region alongside a country does not suppress the country", () => {
    expect(r("Berlin, Germany / EMEA")).toBe("DE");
  });
});

describe("remote", () => {
  test("bare remote markers", () => {
    expect(r("Remote")).toBe("remote");
    expect(r("Fully remote")).toBe("remote");
    expect(r("Anywhere")).toBe("remote");
    expect(r("Worldwide")).toBe("remote");
    expect(r("Work from home")).toBe("remote");
    expect(r("Télétravail")).toBe("remote");
  });

  test("remote scoped to a country still names the country", () => {
    expect(r("Remote (US)")).toBe("US");
    expect(r("Remote - Germany")).toBe("DE");
    expect(r("Remote Germany")).toBe("DE");
    expect(r("Remote in Germany")).toBe("DE");
  });

  test("remote scoped to a region stays a region", () => {
    expect(r("Remote (EMEA)")).toBe("region");
    expect(r("Remote - EMEA")).toBe("region");
  });
});

describe("multi-location", () => {
  test("alternatives are unioned", () => {
    expect(r("Paris / London")).toBe("FR+GB");
    expect(r("Paris / London or Remote")).toBe("FR+GB");
    expect(r("Berlin | Madrid")).toBe("DE+ES");
    expect(r("Paris ou Lyon")).toBe("FR");
    expect(r("Amsterdam; Berlin")).toBe("DE+NL");
  });

  test("hierarchical parts are not unioned", () => {
    // Two readings of ONE place must not become two countries.
    expect(r("Atlanta, Georgia, United States")).toBe("US");
    expect(r("Austin, TX, United States")).toBe("US");
  });

  test("a comma between two cities in different countries is a list", () => {
    // A hierarchy never contradicts itself, so this can only be two places.
    expect(r("Paris, Lisbonne")).toBe("FR+PT");
    expect(r("Berlin, Amsterdam")).toBe("DE+NL");
  });

  test("cross-language exonyms of big cities", () => {
    expect(r("Londres")).toBe("GB");
    expect(r("Lisbonne")).toBe("PT");
    expect(r("Mailand")).toBe("IT");
  });

  test("a facility word does not hide the city", () => {
    expect(r("San Francisco HQ")).toBe("US");
    expect(r("Berlin office")).toBe("DE");
  });

  test("countries come back sorted and deduplicated", () => {
    expect(resolveLocation("London / Paris / Berlin / Paris").countries).toEqual([
      "DE",
      "FR",
      "GB",
    ]);
  });
});

describe("noise and edge cases", () => {
  test("never throws, always answers", () => {
    for (const input of [null, undefined, "", "   ", "—", "???", "HQ — 2nd floor", "N/A", "TBD"]) {
      const out = resolveLocation(input);
      expect(out.countries).toEqual([]);
      expect(out.resolution).toBe("unknown");
    }
  });

  test("office decoration next to a real place still resolves", () => {
    expect(r("HQ — Berlin")).toBe("DE");
    expect(r("Office: Paris, France")).toBe("FR");
  });

  test("non-latin scripts are unknown, never guessed", () => {
    expect(r("東京")).toBe("unknown");
    expect(r("Москва")).toBe("unknown");
  });
});

describe("dataset integrity", () => {
  test("a truncated rebuild would fail here", () => {
    expect(GEO_DATASET_META.cities).toBeGreaterThan(30_000);
    expect(GEO_DATASET_META.cityKeys).toBeGreaterThan(30_000);
    expect(GEO_DATASET_META.countryNames).toBeGreaterThan(1_000);
    // 50 states + DC + 13 provinces.
    expect(GEO_DATASET_META.subdivisionNames).toBe(64);
  });

  test("the dataset stays out of the package barrel", () => {
    // ~530 kB behind `@outrival/shared/geo`. Re-exporting it from the barrel would
    // put it in the web bundle, which has no use for it at all — the browser turns
    // country codes into labels with Intl.DisplayNames.
    const barrel = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8");
    expect(barrel).not.toMatch(/\.\/geo/);
  });

  test("the module is offline by construction", () => {
    // The doctrine here is not "we don't call the network today", it is "this
    // cannot call the network". A source-level check is the only assertion that
    // still holds after someone adds a convenient lookup six months from now.
    const dir = join(import.meta.dir);
    for (const file of ["resolve.ts", "normalize.ts", "index.ts"]) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(|node:https?|axios|XMLHttpRequest|undici/);
    }
  });
});
