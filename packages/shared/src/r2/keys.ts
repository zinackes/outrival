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

/**
 * Where a battle card being written parks its text while the job runs, so the page
 * can watch it arrive. Keyed by the couple the card belongs to rather than by the
 * run, because the reader asks for a competitor and a product — it has no run id
 * until it has started one, and it must also find the buffer of a generation it
 * only rejoined (a reload mid-run). One card per couple, so one buffer per couple.
 *
 * Overwritten on every run and deleted when the card lands; a reader ignores one
 * that has gone stale, so a crashed run leaves a harmless object, never a ghost.
 */
export function battleCardStreamKey(competitorId: string, productId?: string | null): string {
  return `battle-cards/streams/${competitorId}/${productId ?? "default"}.json`;
}
