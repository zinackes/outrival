const KNOWN_EXTENSIONS = [".html", ".png", ".txt", ".pdf"];

/**
 * Snapshot rows store the R2 key WITHOUT an extension (see scrape-monitor.ts:908);
 * the uploader writes `${key}.html`, `${key}.png` and, for review-theme snapshots,
 * `${key}.txt`. Deletion has to reconstruct those, which is why this lives in one
 * place: the previous inline `key.replace(/\.html$/, ".png")` never matched, so no
 * snapshot object was ever deleted.
 *
 * Defensive on input: a key that already carries a known extension is returned as
 * itself, so a future row shape (or a battle-card PDF key passed here by mistake)
 * cannot produce `foo.pdf.html`.
 */
export function snapshotObjectKeys(storedKey: string): string[] {
  const key = storedKey.trim();
  if (!key) return [];
  if (KNOWN_EXTENSIONS.some((ext) => key.endsWith(ext))) return [key];
  return [`${key}.html`, `${key}.png`, `${key}.txt`];
}
