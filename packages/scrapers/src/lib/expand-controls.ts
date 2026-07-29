/**
 * Recognising a list's own "Show more" control, by label.
 *
 * Pure and browser-free so the decision can be tested directly: the click loop that
 * uses it runs inside `page.evaluate`, where nothing is observable.
 */

/**
 * Labels of an APPEND-style pagination control, in the languages our competitors
 * actually ship. Anchored at the start of the trimmed label so a paragraph that
 * merely contains the word "more" can never match.
 *
 * Numbered pagination ("Next", "2", "3") is deliberately absent: those REPLACE the
 * rows instead of appending them, so following one would need page-by-page merge
 * logic, and the capture after the last click would hold the LAST page only —
 * strictly worse than the first-page slice we have today.
 */
export const EXPAND_LABEL =
  /^(?:(?:show|load|view|see|display)\s+(?:\d+\s+)?(?:more|all)|more|(?:voir|afficher|charger)\s+(?:plus|davantage|tout|toutes)|plus\s+d[’']|mehr\s+(?:anzeigen|laden)|weitere\s+\w+|(?:ver|mostrar|cargar)\s+m[aá]s|(?:mostra|carica)\s+altri)\b/i;

/** Longest label still plausibly a button and not a sentence that starts with "More". */
export const EXPAND_LABEL_MAX_CHARS = 40;

/**
 * True when this control's label reads as "add the next page of rows to this list".
 * Whitespace is collapsed first: a wrapped button label arrives with newlines in it.
 */
export function isExpandControlLabel(label: string): boolean {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > EXPAND_LABEL_MAX_CHARS) return false;
  return EXPAND_LABEL.test(normalized);
}
