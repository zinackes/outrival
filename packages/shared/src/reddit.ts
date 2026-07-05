/**
 * Reddit mention snapshots (patch-32). The scraper renders competitor mentions into
 * a deterministic HTML document carrying a JSON island (see @outrival/scrapers
 * reddit.ts `buildRedditDoc`). The Mentions tab reads the latest snapshot back from
 * R2 and re-parses that island here — the posts live in the snapshot, so there is no
 * separate table to persist or migrate. Marker + shape are shared so the writer
 * (scrapers) and this reader can never drift.
 */

/** id of the JSON island `<script>` embedded in a Reddit snapshot document. */
export const REDDIT_SNAPSHOT_MARKER = "outrival-reddit-mentions";

export interface RedditMentionData {
  id: string;
  title: string;
  subreddit: string;
  /** Net upvotes (a proxy for reach). */
  score: number;
  numComments: number;
  permalink: string;
  createdUtc: number;
  body: string;
}

export interface RedditSnapshotData {
  query: string;
  mentions: RedditMentionData[];
}

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}
function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Parse the JSON island out of a stored Reddit snapshot document. Best-effort:
 * returns null when the marker/island is absent or unparseable (older or non-Reddit
 * snapshot). The island's `<` are escaped to `<`, which JSON.parse decodes
 * natively, so there is never a literal `</script>` to truncate the match.
 */
export function parseRedditSnapshotHtml(html: string): RedditSnapshotData | null {
  const re = new RegExp(
    `<script[^>]*id="${REDDIT_SNAPSHOT_MARKER}"[^>]*>([\\s\\S]*?)</script>`,
  );
  const match = re.exec(html);
  if (!match?.[1]) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as { mentions?: unknown }).mentions;
  if (!Array.isArray(raw)) return null;
  const mentions: RedditMentionData[] = raw.map((m) => {
    const d = (m ?? {}) as Record<string, unknown>;
    return {
      id: str(d.id),
      title: str(d.title),
      subreddit: str(d.subreddit),
      score: num(d.score),
      numComments: num(d.numComments),
      permalink: str(d.permalink),
      createdUtc: num(d.createdUtc),
      body: str(d.body),
    };
  });
  return { query: str((parsed as { query?: unknown }).query), mentions };
}
