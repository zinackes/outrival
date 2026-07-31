/**
 * Deterministic, offline resolution of a job posting's free-text `location` to
 * ISO-3166-1 alpha-2 country codes.
 *
 * ZERO AI, ZERO NETWORK, ZERO GUESSING — those three are the feature, not an
 * implementation detail. `first_role_in_country` is a HIGH-severity signal, so a
 * country asserted on a coin flip is worse than no country at all: it fabricates a
 * geographic expansion that never happened. Anything this module cannot pin down
 * comes back `unknown`, which the Hiring tab shows as its own line rather than
 * hiding.
 *
 * The lookup tables are built from GeoNames at build time and committed
 * (`dataset.generated.ts`, see `scripts/build-geo-dataset.ts`); nothing here reads
 * the filesystem or the network.
 *
 * HOW A LOCATION IS READ
 *
 *  1. The string is cut into PLACES on separators that mean "or" (`/`, `|`, `;`,
 *     `&`, " or ", " ou ", newline). Their results are UNIONED: "Paris / London"
 *     is two countries.
 *  2. Each place is cut into PARTS on separators that refine one place (`,`, `-`,
 *     `:`, parentheses). "Austin, TX, United States" is ONE place said three times.
 *  3. Each part is turned into the SET of countries it could denote — a country
 *     name or code, a US state / Canadian province, a city (possibly in several
 *     countries) — and the place resolves to the INTERSECTION of those sets.
 *
 * Step 3 is where this departs from a fixed "country > state > city" precedence,
 * and it is deliberate: no fixed order is correct. Reading the country name first
 * turns "Atlanta, Georgia" into the country Georgia; reading the state first turns
 * "Tbilisi, Georgia" into the United States. The intersection gets both right
 * without knowing anything about Georgia, because the OTHER part of the string
 * already rules one reading out. The same mechanism is what lets "Cambridge, MA"
 * resolve (the state code and the city agree on exactly one country) while bare
 * "Cambridge" — England, Ontario, Massachusetts, all within 12% of each other in
 * population — stays honestly unknown.
 *
 * When the intersection is EMPTY the parts contradict each other ("Paris,
 * Ontario"). City names are the fuzzy input and exact labels are not, so the city
 * constraints are dropped and the labels re-read: Paris, Ontario is in Canada.
 */

import {
  CITY_ENTRIES,
  COUNTRY_CODE_ENTRIES,
  COUNTRY_NAME_ENTRIES,
  SUBDIVISION_CODE_ENTRIES,
  SUBDIVISION_NAME_ENTRIES,
} from "./dataset.generated";
import { normalizeGeoKey, stripPlaceWrappers } from "./normalize";

export type GeoResolution = "country" | "region" | "remote" | "unknown";

export interface ResolvedLocation {
  /** ISO-3166-1 alpha-2, uppercase, deduplicated, sorted. Empty unless resolution is "country". */
  countries: string[];
  resolution: GeoResolution;
}

/**
 * How many times more populous the leading claimant of an ambiguous city name must
 * be before we call it. Paris FR is 85× Paris TX — decided. Cambridge GB is 1.1×
 * Cambridge ON — not decided, and no amount of wanting a data point makes it so.
 * Calibrated against the real distribution: it keeps Birmingham (5.9×) and Dublin
 * (17×), and rejects Cambridge and Valencia.
 */
const POPULATION_RATIO = 5;

// "or" separators: each side is a DIFFERENT place, and the results are unioned.
// " and " is deliberately absent — it would split Trinidad and Tobago.
const PLACE_SPLIT = /\s*(?:\/|\||;|&|·|•|\r?\n|\bor\b|\bou\b)\s*/i;

// Refinement separators: the parts describe ONE place at different granularities.
// The dash is only a separator when spaced, so Saint-Denis survives.
const PART_SPLIT = /\s*(?:,|\(|\)|\[|\]|:|\s[-–—]\s)\s*/;

const REMOTE_TOKENS = new Set([
  "remote", "fully remote", "full remote", "100 remote", "remote first",
  "remote only", "remote friendly", "work from home", "wfh", "home office",
  "homeoffice", "anywhere", "anywhere in the world", "worldwide", "world wide",
  "global", "globally", "distributed", "telecommute", "virtual",
  // FR / DE / ES / IT / PT
  "teletravail", "a distance", "full remote france", "remoto", "en remoto",
  "teletrabajo", "trabajo remoto", "ortsunabhangig", "standortunabhangig",
  "lavoro da remoto", "trabalho remoto",
]);

// Whole-word remote markers for a part that carries more than the marker
// ("Remote Germany"). Matching one flags remote and the marker is removed before
// the remainder is read as a place, so the country is not lost.
const REMOTE_PHRASE =
  /\b(?:fully\s+remote|remote(?:\s+first|\s+only|\s+friendly)?|work\s+from\s+home|wfh|telecommute|teletravail|homeoffice)\b/i;
// Fillers left behind once the marker is gone: "Remote in Germany" → "Germany".
const REMOTE_FILLER = /^(?:in|from|within|across|based\s+in|anywhere\s+in|the)\b\s*/i;

// Supranational regions. A region is NOT a country: it never feeds `countries`, so
// it can never fire first_role_in_country. "EMEA" says nothing about which of the
// hundred-odd countries in it a role sits in, and pretending otherwise would be the
// single easiest way to fabricate an expansion signal.
const REGION_TOKENS = new Set([
  "emea", "apac", "apj", "latam", "latin america", "noram", "amer", "americas",
  "north america", "south america", "central america", "europe", "eu", "eea",
  "western europe", "eastern europe", "southern europe", "northern europe",
  "central europe", "dach", "benelux", "nordics", "nordic", "nordic countries",
  "scandinavia", "mena", "middle east", "middle east and africa", "asia",
  "asia pacific", "southeast asia", "south east asia", "south asia", "east asia",
  "anz", "oceania", "africa", "sub saharan africa", "north africa", "uki",
  "uk and ireland", "cee", "gcc", "caribbean", "iberia", "baltics", "balkans",
]);

interface CityCandidate {
  cc: string;
  /** Population in thousands. 0 when the key names a single country (never compared). */
  pop: number;
}

interface Tables {
  countryNames: Map<string, string>;
  countryCodes: Map<string, string>;
  subNames: Map<string, string>;
  subCodes: Map<string, string>;
  cities: Map<string, CityCandidate[]>;
}

let tables: Tables | null = null;

function parseSimple(entries: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of entries.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

/**
 * Build the lookup Maps once, on first use. Deferred rather than done at module
 * load so importing anything else from the package never pays for the dataset.
 */
function getTables(): Tables {
  if (tables) return tables;
  const cities = new Map<string, CityCandidate[]>();
  for (const line of CITY_ENTRIES.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const key = line.slice(0, tab);
    const value = line.slice(tab + 1);
    if (!value.includes(":")) {
      cities.set(key, [{ cc: value, pop: 0 }]);
      continue;
    }
    cities.set(
      key,
      value.split(",").map((part) => {
        const [cc, pop] = part.split(":");
        return { cc: cc ?? "", pop: Number(pop ?? 0) };
      }),
    );
  }
  tables = {
    countryNames: parseSimple(COUNTRY_NAME_ENTRIES),
    countryCodes: parseSimple(COUNTRY_CODE_ENTRIES),
    subNames: parseSimple(SUBDIVISION_NAME_ENTRIES),
    subCodes: parseSimple(SUBDIVISION_CODE_ENTRIES),
    cities,
  };
  return tables;
}

/** City candidates for a key, retrying once without metro-area decoration. */
function lookupCity(t: Tables, key: string): CityCandidate[] | null {
  const direct = t.cities.get(key);
  if (direct) return direct;
  const stripped = stripPlaceWrappers(key);
  return stripped ? (t.cities.get(stripped) ?? null) : null;
}

interface Constraint {
  /** Countries this part could denote. */
  options: Set<string>;
  /** Populated only for a city constraint — the tie-break input. */
  candidates: CityCandidate[] | null;
  /** The part named a US state or Canadian province: the most specific exact label. */
  fromSubdivision: boolean;
}

/** Everything one part of a place tells us. */
function readPart(
  t: Tables,
  raw: string,
  depth = 0,
): { constraint: Constraint | null; remote: boolean; region: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { constraint: null, remote: false, region: false };

  const key = normalizeGeoKey(trimmed);
  if (!key) return { constraint: null, remote: false, region: false };

  if (REMOTE_TOKENS.has(key)) return { constraint: null, remote: true, region: false };
  if (REGION_TOKENS.has(key)) return { constraint: null, remote: false, region: true };

  // "Remote Germany" / "Remote in Germany": flag remote, then read what is left.
  // Stripped off the ORIGINAL casing, not the folded key, so the leftover "US" is
  // still shouting and still readable as a country code.
  if (depth === 0 && REMOTE_PHRASE.test(key)) {
    const rest = trimmed
      .replace(REMOTE_PHRASE, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(REMOTE_FILLER, "")
      .trim();
    if (!rest) return { constraint: null, remote: true, region: false };
    const inner = readPart(t, rest, depth + 1);
    return { constraint: inner.constraint, remote: true, region: inner.region };
  }

  return { constraint: readKey(t, key, trimmed), remote: false, region: false };
}

/**
 * The country options a normalized key denotes. `original` is the untouched token:
 * a two- or three-letter CODE is only honoured when it was written in caps, because
 * lowercase "in", "de" and "la" are ordinary words in the languages these boards are
 * written in, while "Amsterdam, NL" is always shouted.
 *
 * A part that carries an exact LABEL — a country name or code, a US state, a
 * Canadian province — is read as that label and its city reading is discarded. This
 * is the "country > subdivision > city" precedence, and it only ever applies WITHIN
 * one part: "Ontario" is the province, not the town in California, but which
 * country "Paris, Ontario" ends up in is still settled by the parts together.
 */
function readKey(t: Tables, key: string, original: string): Constraint | null {
  const labels = new Set<string>();
  let fromSubdivision = false;

  const byName = t.countryNames.get(key);
  if (byName) labels.add(byName);

  const bySub = t.subNames.get(key);
  if (bySub) {
    labels.add(bySub);
    fromSubdivision = true;
  }

  if (/^[A-Z]{2,3}$/.test(original)) {
    const byCode = t.countryCodes.get(original);
    if (byCode) labels.add(byCode);
    const bySubCode = t.subCodes.get(original);
    if (bySubCode) {
      labels.add(bySubCode);
      fromSubdivision = true;
    }
  }

  if (labels.size > 0) return { options: labels, candidates: null, fromSubdivision };

  const city = lookupCity(t, key);
  if (city) {
    return { options: new Set(city.map((c) => c.cc)), candidates: city, fromSubdivision: false };
  }
  return null;
}

function intersect(constraints: Constraint[]): Set<string> {
  let acc: Set<string> | null = null;
  for (const c of constraints) {
    if (!acc) {
      acc = new Set(c.options);
      continue;
    }
    acc = new Set([...acc].filter((cc) => c.options.has(cc)));
  }
  return acc ?? new Set<string>();
}

/**
 * Pick between several surviving countries using city population, or return null.
 * Only the leading two matter: if the top is not `POPULATION_RATIO` times the
 * runner-up, the name is not decided and nothing is claimed.
 */
function breakTie(constraints: Constraint[], allowed: Set<string>): string | null {
  const best = new Map<string, number>();
  for (const c of constraints) {
    if (!c.candidates) continue;
    for (const cand of c.candidates) {
      if (!allowed.has(cand.cc)) continue;
      best.set(cand.cc, Math.max(best.get(cand.cc) ?? 0, cand.pop));
    }
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top) return null;
  if (!second) return top[0];
  if (top[1] >= POPULATION_RATIO * Math.max(second[1], 1)) return top[0];
  return null;
}

/** One constraint on its own: decided outright, or decided by population, or not. */
function resolveAlone(c: Constraint): string | null {
  if (c.options.size === 1) return [...c.options][0] ?? null;
  return breakTie([c], c.options);
}

function resolvePlace(t: Tables, place: string): {
  countries: string[];
  remote: boolean;
  region: boolean;
} {
  const constraints: Constraint[] = [];
  let remote = false;
  let region = false;

  for (const part of place.split(PART_SPLIT)) {
    const read = readPart(t, part);
    if (read.remote) remote = true;
    if (read.region) region = true;
    if (read.constraint) constraints.push(read.constraint);
  }

  if (constraints.length === 0) return { countries: [], remote, region };

  const surviving = intersect(constraints);

  if (surviving.size === 0) {
    // The parts contradict. Three readings, tried in order of how much each part is
    // actually asserting:
    //
    //  1. A US state or Canadian province is the most specific exact label there is
    //     — "Paris, Ontario" is a real Canadian town the city dataset is too coarse
    //     to hold, and the province is not in doubt.
    //  2. Any exact label — "Lebanon, OH" is a country name doing duty as a town.
    //  3. Nothing but cities that disagree. A hierarchy ("Austin, TX, United
    //     States") never contradicts itself, so a comma between two cities in
    //     different countries is not narrowing one place, it is LISTING two:
    //     "Paris, Lisbonne" is a French board offering both. Each is resolved on its
    //     own and the results are unioned.
    for (const fallback of [
      constraints.filter((c) => c.fromSubdivision),
      constraints.filter((c) => !c.candidates),
    ]) {
      if (fallback.length === 0) continue;
      const narrowed = intersect(fallback);
      if (narrowed.size === 1) return { countries: [...narrowed], remote, region };
    }
    if (constraints.every((c) => c.candidates)) {
      const listed = constraints.map(resolveAlone).filter((cc): cc is string => cc !== null);
      return { countries: [...new Set(listed)], remote, region };
    }
    return { countries: [], remote, region };
  }

  if (surviving.size === 1) {
    return { countries: [...surviving], remote, region };
  }
  const decided = breakTie(constraints, surviving);
  return { countries: decided ? [decided] : [], remote, region };
}

/**
 * Resolve a free-text job location to the countries it names.
 *
 * Pure and total: any input, including null, returns a value. `countries` is only
 * non-empty for `resolution: "country"` — a region ("EMEA") and a remote posting
 * name no country, and saying otherwise is how a hiring-expansion signal gets
 * invented out of a job board's boilerplate.
 */
export function resolveLocation(location: string | null | undefined): ResolvedLocation {
  if (!location || !location.trim()) return { countries: [], resolution: "unknown" };

  const t = getTables();
  const countries = new Set<string>();
  let remote = false;
  let region = false;

  for (const place of location.split(PLACE_SPLIT)) {
    if (!place.trim()) continue;
    const result = resolvePlace(t, place);
    for (const cc of result.countries) countries.add(cc);
    if (result.remote) remote = true;
    if (result.region) region = true;
  }

  if (countries.size > 0) {
    return { countries: [...countries].sort(), resolution: "country" };
  }
  if (region) return { countries: [], resolution: "region" };
  if (remote) return { countries: [], resolution: "remote" };
  return { countries: [], resolution: "unknown" };
}
