// Normalization shared by the geo build script and the runtime resolver. If these
// two ever disagree the committed dataset becomes unreachable, so it lives in one
// file that both import — never re-implemented on either side.

// Letters NFD does not decompose (they are distinct code points, not base+accent).
// Without this, "København" normalizes to "kbenhavn" and never matches.
const IRREGULAR: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
  ŧ: "t",
  ħ: "h",
  ŋ: "n",
  ĸ: "k",
};

/**
 * Fold a place label to its lookup key: lowercase, irregular letters expanded,
 * diacritics stripped, everything non-alphanumeric collapsed to single spaces.
 *
 * "München" → "munchen", "Saint-Étienne" → "saint etienne", "S.F." → "s f".
 * Returns "" for anything that carries no latin letters or digits (CJK, Cyrillic,
 * Arabic) — the caller treats an empty key as unresolvable rather than matching it.
 */
export function normalizeGeoKey(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[øæœßłđðþıŧħŋĸ]/g, (ch) => IRREGULAR[ch] ?? ch);
  s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  return s;
}

// Wrappers a metro area gets written with. "Greater London Area" and "London" are
// the same place to a hiring-geo aggregate, and neither GeoNames nor any gazetteer
// carries the decorated form. Stripped only as a SECOND attempt, so a real city
// whose name happens to contain one of these words still matches itself first.
const WRAPPER_PREFIXES = /^(?:greater|grand|gross|metropolitan|metro|region of|city of|the)\s+/;
// "San Francisco HQ" and "Berlin office" are a place with a facility word stuck to
// it — the commonest single reason a real city fails to resolve on a live board.
const WRAPPER_SUFFIXES =
  /\s+(?:metropolitan area|metro area|urban area|and surroundings|surroundings|area|region|metropolitan|metro|county|city|province|prefecture|district|hq|headquarters|head office|office|campus|based)$/;

/**
 * The de-decorated variant of an already-normalized key, or null when nothing was
 * stripped. Applied repeatedly so "greater london metropolitan area" reduces to
 * "london".
 */
export function stripPlaceWrappers(key: string): string | null {
  let s = key;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(WRAPPER_PREFIXES, "").replace(WRAPPER_SUFFIXES, "").trim();
    if (next === s) break;
    s = next;
  }
  return s !== key && s.length > 0 ? s : null;
}
