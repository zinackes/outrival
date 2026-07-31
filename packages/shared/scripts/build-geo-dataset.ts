#!/usr/bin/env bun
/**
 * Build `src/geo/dataset.generated.ts` — the committed, network-free lookup behind
 * `resolveLocation()`.
 *
 * WHY A BUILD SCRIPT AND NOT A DEPENDENCY (options considered, 2026-07-31)
 * ------------------------------------------------------------------------
 * The requirement is a 100% deterministic, offline, zero-AI resolution of an ATS
 * `location` string to ISO-3166-1 alpha-2 codes. Four shapes of prior art exist:
 *
 *  - `all-the-cities` (npm, 138k cities ≥1000 inhabitants, ~11 MB of JSON): a
 *    RUNTIME dependency the size of the rest of the package put together, carrying
 *    coordinates we never use, no country names, and no localized city names. It is
 *    also indexed for geospatial search, not for text lookup.
 *  - `cities15000` / `cities15000-json` (npm): the same GeoNames extract, last
 *    published 9 years ago — a stale mirror of a dump we can read directly.
 *  - `offline-geocoder` / `local-reverse-geocoder`: ~12 MB SQLite, and REVERSE
 *    geocoders — they answer "which city is at this lat/lon". We have text, not
 *    coordinates. Wrong shape.
 *  - `i18n-iso-countries` (npm, ~620 kB installed): country names in 79 languages.
 *    Genuinely useful — but `Intl.DisplayNames`, which ships inside Node, Bun and
 *    every browser, returns the same strings for free. A dependency that duplicates
 *    an ICU table already in the runtime is a dependency we can not take.
 *
 * So: no runtime dependency at all. This script reads the GeoNames dumps at BUILD
 * time and emits a minified lookup that is committed to the repo, which keeps the
 * runtime free of both network and packages, and — the reason that actually
 * matters — lets us decide collision by collision what the dataset is allowed to
 * claim. A generic package would happily resolve "Monaco" to Munich, because
 * GeoNames lists it as an alternate name for München.
 *
 * SOURCES (all CC BY 4.0 — see NOTICE at the repo root)
 *  - cities15000.txt        cities >15k inhabitants (+ capitals): name, country, population
 *  - countryInfo.txt        ISO2/ISO3, English name, official languages
 *  - admin1CodesASCII.txt   first-level subdivisions (US states carry postal codes)
 *  - alternatenames/{CC}.zip per-country alternate names WITH an isolanguage column
 *
 * The per-country alternate files are the reason this is not a five-line script.
 * The `alternatenames` COLUMN inside cities15000.txt is untagged, so Munich's
 * variants there include "MUC", "Minga" and "Monaco" — untyped noise that would
 * make the dataset assert nonsense. The per-country files carry the language, so we
 * keep only the names written in the city's OWN languages (plus English): that is
 * "München", "Köln", "Wien", "København" — the spellings a local job board prints —
 * and none of the transliterations.
 *
 * USAGE
 *   bun packages/shared/scripts/build-geo-dataset.ts [--cache <dir>]
 *
 * Requires network (build time only) and the `unzip` CLI. Downloads are cached, so
 * a re-run after tweaking the filters costs nothing. Output is deterministic: same
 * dumps in, byte-identical file out.
 */

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGeoKey } from "../src/geo/normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "geo", "dataset.generated.ts");
const BASE = "https://download.geonames.org/export/dump";

const cacheArg = process.argv.indexOf("--cache");
const CACHE = cacheArg > -1 ? process.argv[cacheArg + 1]! : join(HERE, ".geo-cache");

// Population floor for a city to earn ALTERNATE spellings. Every city ≥15k is in the
// dataset under its GeoNames name; alternates exist for the case where the local
// spelling differs from it, which is a big-city phenomenon (München/Munich,
// Wien/Vienna, København/Copenhagen). Below this floor the GeoNames name IS the
// local name, so alternates would only add weight and collisions.
const ALTERNATE_POP_FLOOR = 50_000;

// Above this size a city also earns its EXONYMS — the names OTHER languages give
// it. "Londres" and "Lisbonne" are not names London and Lisbon carry in their own
// languages, and a French-language board writes them anyway. Restricted to large
// cities because the exonym is a big-city phenomenon and because every extra name
// is another chance to collide; primary names always win a collision, so this can
// widen coverage without ever letting an exonym take over a real city.
const EXONYM_POP_FLOOR = 400_000;

// Locales whose country names are generated from ICU. Latin-script only: a name that
// normalizes to "" (Cyrillic, CJK, Arabic) is dropped, so adding those locales would
// cost bytes for nothing.
const COUNTRY_NAME_LOCALES = [
  "en", "fr", "de", "es", "it", "nl", "pt", "sv", "da", "nb", "fi", "pl",
  "cs", "sk", "ro", "hu", "hr", "sl", "et", "lv", "lt", "tr", "ga", "is",
];

/** Languages a big city's exonyms are kept in — the same latin set as the countries. */
const EXONYM_LOCALES = new Set(COUNTRY_NAME_LOCALES);

// Shorthands and historical names no ICU table returns, plus the constituent
// countries of the UK (not ISO entities, but a job board writes them).
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US", "u s a": "US", "u s": "US", america: "US",
  "united states of america": "US", "the united states": "US",
  uk: "GB", "u k": "GB", "great britain": "GB", britain: "GB",
  england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  holland: "NL", "the netherlands": "NL",
  "czech republic": "CZ", czechia: "CZ",
  "ivory coast": "CI", burma: "MM", uae: "AE",
  "republic of ireland": "IE", eire: "IE",
  "south korea": "KR", "north korea": "KP",
  // A job board writing "Korea" means the one that posts jobs. Same class of
  // shorthand as "Holland" and "Britain", not a coin flip.
  korea: "KR",
  turkiye: "TR", "cape verde": "CV", swaziland: "SZ",
  "vatican city": "VA", "east timor": "TL",
};

// GeoNames numbers Canadian provinces (CA.01 = Alberta); only the US admin1 codes
// are the postal codes people actually write. The 13 Canadian ones are stable and
// hardcoded rather than inferred.
const CA_PROVINCE_CODES: Record<string, string> = {
  Alberta: "AB", "British Columbia": "BC", Manitoba: "MB", "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL", "Northwest Territories": "NT", "Nova Scotia": "NS",
  Nunavut: "NU", Ontario: "ON", "Prince Edward Island": "PE", Quebec: "QC",
  Saskatchewan: "SK", Yukon: "YT",
};

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

async function fetchCached(path: string, name: string): Promise<void> {
  const dest = join(CACHE, name);
  if (await exists(dest)) return;
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function unzipToText(zip: string, member: string): Promise<string> {
  const proc = Bun.spawn(["unzip", "-p", join(CACHE, zip), member], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`unzip ${zip}/${member} failed`);
  return text;
}

interface City {
  cc: string;
  pop: number;
  id: string;
}

// key → candidates, most populous first. A key with one candidate stores no
// population (it is never compared); an ambiguous one stores every candidate's
// population in thousands, which is all the tie-break ratio needs.
type CityIndex = Map<string, City[]>;

function addCity(index: CityIndex, key: string, city: City): void {
  if (!key) return;
  const list = index.get(key);
  if (!list) {
    index.set(key, [city]);
    return;
  }
  // Same city reached twice (name === asciiname, or two alternates that fold
  // together) must not become a false ambiguity.
  if (list.some((c) => c.id === city.id)) return;
  list.push(city);
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true });

  console.log("• fetching base dumps");
  await Promise.all([
    fetchCached("cities15000.zip", "cities15000.zip"),
    fetchCached("countryInfo.txt", "countryInfo.txt"),
    fetchCached("admin1CodesASCII.txt", "admin1CodesASCII.txt"),
  ]);

  // ---- countries -----------------------------------------------------------
  const countryInfo = await readFile(join(CACHE, "countryInfo.txt"), "utf8");
  const officialLangs = new Map<string, Set<string>>();
  const countryNames = new Map<string, string>(); // normalized name → CC
  const countryCodes = new Map<string, string>(); // UPPERCASE code → CC
  const iso2 = new Set<string>();

  for (const line of countryInfo.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    const cc = f[0] ?? "";
    if (cc.length !== 2) continue;
    iso2.add(cc);
    countryCodes.set(cc, cc);
    if (f[1]) countryCodes.set(f[1], cc); // ISO3
    const english = normalizeGeoKey(f[4] ?? "");
    if (english) countryNames.set(english, cc);
    // "de-DE,tr,sr" → {de, tr, sr}. Used to decide which alternate names to keep.
    const langs = new Set(
      (f[15] ?? "")
        .split(",")
        .map((l) => l.split("-")[0]!.trim().toLowerCase())
        .filter(Boolean),
    );
    langs.add("en");
    officialLangs.set(cc, langs);
  }

  for (const locale of COUNTRY_NAME_LOCALES) {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    for (const cc of iso2) {
      const label = dn.of(cc);
      if (!label || label === cc) continue;
      const key = normalizeGeoKey(label);
      // English wins every collision: countryInfo was loaded first and we never
      // overwrite, so a localized name that folds onto another country's English
      // name can not steal it.
      if (key && !countryNames.has(key)) countryNames.set(key, cc);
    }
  }
  for (const [alias, cc] of Object.entries(COUNTRY_ALIASES)) {
    const key = normalizeGeoKey(alias);
    if (key) countryNames.set(key, cc);
  }

  // ---- subdivisions (US states, CA provinces) ------------------------------
  const admin1 = await readFile(join(CACHE, "admin1CodesASCII.txt"), "utf8");
  const subNames = new Map<string, string>(); // normalized name → US | CA
  const subCodes = new Map<string, string>(); // UPPERCASE code → US | CA
  for (const line of admin1.split("\n")) {
    if (!line) continue;
    const [code, name] = line.split("\t");
    if (!code || !name) continue;
    const [cc, local] = code.split(".");
    if (cc === "US" && local) {
      const key = normalizeGeoKey(name);
      if (key) subNames.set(key, "US");
      subCodes.set(local, "US");
    } else if (cc === "CA") {
      const key = normalizeGeoKey(name);
      if (key) subNames.set(key, "CA");
      const postal = CA_PROVINCE_CODES[name];
      if (postal) subCodes.set(postal, "CA");
    }
  }

  // ---- cities --------------------------------------------------------------
  const citiesText = await unzipToText("cities15000.zip", "cities15000.txt");
  const cityIndex: CityIndex = new Map();
  const byId = new Map<string, City>();
  const ccsPresent = new Set<string>();
  let cityRows = 0;

  for (const line of citiesText.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    const id = f[0] ?? "";
    const cc = f[8] ?? "";
    if (!id || cc.length !== 2) continue;
    const city: City = { cc, pop: Number(f[14] ?? 0) || 0, id };
    byId.set(id, city);
    ccsPresent.add(cc);
    cityRows++;
    addCity(cityIndex, normalizeGeoKey(f[1] ?? ""), city);
    addCity(cityIndex, normalizeGeoKey(f[2] ?? ""), city);
  }
  console.log(`• ${cityRows} cities, ${cityIndex.size} primary keys`);

  // ---- alternate spellings, per country, language-filtered -----------------
  console.log(`• fetching ${ccsPresent.size} alternate-name dumps`);
  const ccList = [...ccsPresent].sort();
  const POOL = 12;
  for (let i = 0; i < ccList.length; i += POOL) {
    await Promise.all(
      ccList.slice(i, i + POOL).map((cc) =>
        fetchCached(`alternatenames/${cc}.zip`, `alt_${cc}.zip`).catch((e) => {
          console.warn(`  ! ${cc}: ${e.message}`);
        }),
      ),
    );
  }

  let altKept = 0;
  for (const cc of ccList) {
    if (!(await exists(join(CACHE, `alt_${cc}.zip`)))) continue;
    let text: string;
    try {
      text = await unzipToText(`alt_${cc}.zip`, `${cc}.txt`);
    } catch {
      continue;
    }
    const langs = officialLangs.get(cc) ?? new Set(["en"]);
    for (const line of text.split("\n")) {
      if (!line) continue;
      const f = line.split("\t");
      const city = byId.get(f[1] ?? "");
      if (!city || city.pop < ALTERNATE_POP_FLOOR) continue;
      const lang = (f[2] ?? "").toLowerCase();
      const accepted =
        langs.has(lang) || (city.pop >= EXONYM_POP_FLOOR && EXONYM_LOCALES.has(lang));
      if (!accepted) continue;
      // isColloquial / isHistoric: a nickname or a name the place had before a war
      // is not what a 2026 job board prints.
      if (f[6] === "1" || f[7] === "1") continue;
      const key = normalizeGeoKey(f[3] ?? "");
      if (!key || key.length < 2) continue;
      // A primary name is authoritative and is never displaced by an alternate:
      // this is what keeps "Monaco" (a real city) from being re-pointed at Munich.
      if (cityIndex.has(key)) continue;
      addCity(cityIndex, key, city);
      altKept++;
    }
  }
  console.log(`• ${altKept} alternate spellings kept, ${cityIndex.size} city keys total`);

  // ---- emit ----------------------------------------------------------------
  const cityLines: string[] = [];
  let ambiguousKeys = 0;
  for (const [key, list] of [...cityIndex].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const countries = new Set(list.map((c) => c.cc));
    if (countries.size === 1) {
      cityLines.push(`${key}\t${list[0]!.cc}`);
      continue;
    }
    ambiguousKeys++;
    // One entry per COUNTRY (the resolver answers in countries, not in cities), each
    // carrying that country's most populous claimant, in thousands. Sorted desc so
    // the ratio test reads the first two.
    const best = new Map<string, number>();
    for (const c of list) best.set(c.cc, Math.max(best.get(c.cc) ?? 0, c.pop));
    const parts = [...best]
      .sort((a, b) => b[1] - a[1])
      .map(([cc, pop]) => `${cc}:${Math.max(1, Math.round(pop / 1000))}`);
    cityLines.push(`${key}\t${parts.join(",")}`);
  }

  const fmt = (m: Map<string, string>) =>
    [...m]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}\t${v}`)
      .join("\n");

  const file = `// GENERATED by packages/shared/scripts/build-geo-dataset.ts — DO NOT EDIT.
//
// Source: GeoNames (cities15000, countryInfo, admin1CodesASCII, per-country
// alternate names), CC BY 4.0. Attribution: see NOTICE at the repo root.
//
// Every line is "key\\tvalue". Keys are already folded by normalizeGeoKey, so the
// resolver folds its input once and compares strings — no per-lookup work beyond a
// Map hit. Stored as text rather than an object literal because a 300k-entry object
// literal costs the JS parser far more than one String.split does.
//
// Cities: "key\\tCC" when the key names exactly one country; "key\\tCC:pop,CC:pop"
// (population in thousands, descending) when it names several. An ambiguous key is
// never resolved by position — the resolver needs the populations to decide whether
// the gap is wide enough to call, and to answer "unknown" when it is not.

/** Counts of what the dataset carries, for the tests that guard against a truncated rebuild. */
export const GEO_DATASET_META = {
  cities: ${cityRows},
  cityKeys: ${cityIndex.size},
  ambiguousCityKeys: ${ambiguousKeys},
  countryNames: ${countryNames.size},
  subdivisionNames: ${subNames.size},
} as const;

/** Country names in ${COUNTRY_NAME_LOCALES.length} latin-script locales, plus aliases. Case-insensitive. */
export const COUNTRY_NAME_ENTRIES = \`${fmt(countryNames)}\`;

/** ISO-3166-1 alpha-2 and alpha-3 codes. Matched ONLY against an uppercase token. */
export const COUNTRY_CODE_ENTRIES = \`${fmt(countryCodes)}\`;

/** US state and Canadian province names → the country they belong to. */
export const SUBDIVISION_NAME_ENTRIES = \`${fmt(subNames)}\`;

/** US state / Canadian province postal codes. Matched ONLY against an uppercase token. */
export const SUBDIVISION_CODE_ENTRIES = \`${fmt(subCodes)}\`;

/** Cities ≥15k inhabitants, plus local-language spellings for those ≥${ALTERNATE_POP_FLOOR / 1000}k. */
export const CITY_ENTRIES = \`${cityLines.join("\n")}\`;
`;

  await writeFile(OUT, file, "utf8");
  const kb = (Buffer.byteLength(file) / 1024).toFixed(0);
  console.log(`• wrote ${OUT} (${kb} KB)`);
  console.log(
    `  countries=${countryNames.size} codes=${countryCodes.size} subdivisions=${subNames.size} cityKeys=${cityIndex.size} ambiguous=${ambiguousKeys}`,
  );
}

await main();
