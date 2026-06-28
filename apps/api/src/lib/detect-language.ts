import { franc } from "franc-min";

// franc-min returns ISO 639-3 codes ("fra", "deu", "eng"); the UI badge and the
// foreign-language check want the familiar 2-letter ISO 639-1 form. Map the
// languages we realistically meet on SaaS homepages — anything unmapped falls
// through to its 639-3 code (still correct for the "is it English?" decision,
// just a 3-letter badge).
const ISO3_TO_ISO1: Record<string, string> = {
  eng: "en", fra: "fr", spa: "es", deu: "de", ita: "it", por: "pt",
  nld: "nl", rus: "ru", pol: "pl", ukr: "uk", ces: "cs", slk: "sk",
  hun: "hu", ron: "ro", ell: "el", tur: "tr", swe: "sv", dan: "da",
  nob: "no", nno: "no", fin: "fi", isl: "is", cat: "ca", ara: "ar",
  heb: "he", fas: "fa", hin: "hi", cmn: "zh", jpn: "ja", kor: "ko",
  vie: "vi", tha: "th", ind: "id", zsm: "ms", tgl: "tl", bul: "bg",
  hrv: "hr", srp: "sr", slv: "sl", lit: "lt", lav: "lv", est: "et",
  afr: "af",
};

/**
 * Best-effort language of a block of homepage copy. Returns a lowercase ISO
 * 639-1 code (e.g. "fr"), or null when the text is too short / undetermined for
 * franc to be confident ('und').
 *
 * Detection runs on the actual scraped copy (headline + subheadline + value
 * props), so it catches pages that declare `<html lang="en">` — or nothing —
 * yet whose body is in another language, and the common headline-in-English /
 * description-in-French mix that `<html lang>` alone never surfaces.
 */
export function detectContentLanguage(text: string): string | null {
  const code = franc(text.trim());
  if (code === "und") return null;
  return ISO3_TO_ISO1[code] ?? code;
}
