import { test, expect } from "bun:test";
import {
  classifyLogoName,
  isJunkLogoName,
  isBlankSvgDataUri,
  isStoreBadgeSrc,
  isLanguageFlagSrc,
} from "./logo-name";

// ─── junk: design-tool exports & dimensions ──────────────────────────────────
test("drops design-tool export / shape names", () => {
  for (const n of ["Frame 616", "Group 12", "Rectangle", "Vector", "Mask group", "Layer 1"]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

test("drops pixel-dimension strings (incl. embedded)", () => {
  expect(isJunkLogoName("300x290")).toBe(true);
  expect(isJunkLogoName("120 x 48")).toBe(true);
  expect(isJunkLogoName("Frame 616 300x290")).toBe(true);
});

// ─── junk: colour codes (but not hex-looking words) ──────────────────────────
test("drops colour codes", () => {
  for (const n of ["#FF5733", "#fff", "FF5733", "rgb(0,0,0)", "hsl(210, 50%, 40%)"]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

test("keeps words that merely look hex-ish (no digit)", () => {
  expect(classifyLogoName("Deeded")).toEqual({ kind: "brand", name: "Deeded" });
  expect(classifyLogoName("Face")).toEqual({ kind: "brand", name: "Face" });
});

// ─── junk: review platforms & rating copy ────────────────────────────────────
test("drops review-platform & award badges", () => {
  for (const n of [
    "Capterra Badge",
    "G2",
    "GetApp",
    "Appvizer",
    "Rated 4.5/5 by users",
    "4.8 stars",
    "High Performer",
    "Momentum Leader",
  ]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

// ─── junk: compliance / certification badges ─────────────────────────────────
test("drops compliance / certification badges", () => {
  for (const n of [
    "GDPR Compliant",
    "HIPPA-Compliant",
    "FERPA Compliant",
    "SOC 2 certified",
    "ISO 27001 certified company",
  ]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

// ─── junk: testimonial author names (titled, or three full name tokens) ───────
test("drops three-word person names and titled names", () => {
  for (const n of ["Erin Luers Abbott", "David Magnier Jr", "Dr. Shelby Hill", "Mme. Claire Roy"]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

test("keeps two-word names that are too brand-ambiguous to drop", () => {
  // First/Last-looking brands must survive the person heuristic.
  for (const n of ["Getty Images", "Robert Half", "Morgan Stanley", "Sue Riekels"]) {
    expect(classifyLogoName(n).kind).toBe("brand");
  }
});

test("does not treat org-keyword names as persons", () => {
  for (const n of [
    "Sommet Education",
    "Brave Browser",
    "Harson university",
    "City of Columbia",
    "University of South Carolina",
  ]) {
    expect(classifyLogoName(n).kind).toBe("brand");
  }
});

// ─── junk: descriptive feature phrases ───────────────────────────────────────
test("drops lowercase descriptive phrases", () => {
  expect(isJunkLogoName("logiciel de recherche")).toBe(true);
  expect(isJunkLogoName("search and filter")).toBe(true);
});

// ─── junk: language-switcher labels ──────────────────────────────────────────
test("drops bare language names — endonym, English & French exonyms, any casing/accent", () => {
  for (const n of [
    "Français", "français", "Anglais", "Italien", "Español", "Deutsch", "English",
    "Nederlands", "Português", "Svenska", "Polski", "Türkçe", "Čeština", "Norsk",
    "French", "Spanish", "German", "Russian", "Arabic", "Greek", "Korean",
    "Allemand", "Néerlandais", "Suédois", "Tchèque", "Coréen", "Russe", "Grec",
    "中文", "日本語", "한국어", "Русский", "العربية",
  ]) {
    expect(isJunkLogoName(n)).toBe(true);
  }
});

test("keeps brands that merely contain/extend a language word (whole-string match)", () => {
  // "deutsche" ≠ "deutsch", "polished" ≠ "polish", two-word name isn't the bare word.
  for (const n of ["Deutsche Bank", "Polished", "French Connection"]) {
    expect(classifyLogoName(n).kind).toBe("brand");
  }
});

// ─── image-source junk: language-switcher flags ──────────────────────────────
test("isLanguageFlagSrc flags country-flag switcher images", () => {
  for (const s of [
    "https://site.fr/img/flags/fr.svg",
    "https://site.fr/assets/flag-de.png",
    "/static/flag_it.png",
    "https://flagcdn.com/w320/fr.png",
    "https://cdn.x/flag/en.svg",
  ]) {
    expect(isLanguageFlagSrc(s)).toBe(true);
  }
});

test("isLanguageFlagSrc leaves real logos alone (flag as a substring)", () => {
  for (const s of [
    "https://flagship.com/logo.svg",
    "https://x.com/flagstaff-brewing-logo.png",
    "https://acme.com/assets/acme-logo.svg",
  ]) {
    expect(isLanguageFlagSrc(s)).toBe(false);
  }
});

// ─── uninformative: bare placeholders ────────────────────────────────────────
test("placeholders are uninformative (lean on the image)", () => {
  for (const n of ["Logo", "brand logo", "Customer logo", "", "  "]) {
    expect(classifyLogoName(n).kind).toBe("uninformative");
  }
  expect(classifyLogoName(null).kind).toBe("uninformative");
});

// ─── brand: kept, with decorative wrappers stripped ──────────────────────────
test("recovers the clean brand name from decorative wrappers", () => {
  expect(classifyLogoName("ramp client logo")).toEqual({ kind: "brand", name: "ramp" });
  expect(classifyLogoName("loom logo")).toEqual({ kind: "brand", name: "loom" });
  expect(classifyLogoName("Linear Nav Logo")).toEqual({ kind: "brand", name: "Linear" });
  expect(classifyLogoName("Acme (2)")).toEqual({ kind: "brand", name: "Acme" });
});

test("keeps real brands, including lowercase wordmarks", () => {
  for (const n of ["Pepsico", "BigCommerce", "Odoo", "stripe", "Vercel", "Bucknell"]) {
    expect(classifyLogoName(n)).toEqual({ kind: "brand", name: n });
  }
});

// ─── image-source junk ───────────────────────────────────────────────────────
test("isBlankSvgDataUri flags empty <svg/> spacers only", () => {
  expect(
    isBlankSvgDataUri(
      "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20220%20100'%3E%3C/svg%3E",
    ),
  ).toBe(true);
  expect(
    isBlankSvgDataUri("data:image/svg+xml,%3Csvg%3E%3Cpath%20d='M0%200'/%3E%3C/svg%3E"),
  ).toBe(false);
  expect(isBlankSvgDataUri("https://cdn.example.com/acme-logo.svg")).toBe(false);
});

test("isStoreBadgeSrc flags app/play-store download badges", () => {
  expect(isStoreBadgeSrc("https://x.com/apple-store-dark.svg")).toBe(true);
  expect(isStoreBadgeSrc("https://x.com/play-store-dark.svg")).toBe(true);
  expect(isStoreBadgeSrc("https://x.com/google-play.png")).toBe(true);
  expect(isStoreBadgeSrc("https://www.scraperapi.com/uploads/deloitte-logo.svg")).toBe(false);
});
