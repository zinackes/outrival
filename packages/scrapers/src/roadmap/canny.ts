import type { RoadmapEntry, RoadmapParse } from "./types";

/**
 * Canny adapter. A Canny board or roadmap page is server-rendered with its whole
 * Redux state inlined as `window.__data = { … }`, which carries every post's id,
 * title, status and vote score — plus `boards.*.settings.access`, which states
 * outright whether the board is public. So one L0 GET is the entire integration:
 * no browser, no AI, and no official API (Canny's requires the board owner's key).
 *
 * The island is a JavaScript object literal, not JSON: Canny serialises absent
 * cookie values as the bare token `undefined`. Parsing therefore needs a brace scan
 * plus one tolerant substitution — see {@link extractStateIsland}.
 */

/** Canny subdomains that are Canny's own site, never a customer board. */
const CANNY_RESERVED = new Set(["www", "help", "developers", "assets", "api", "blog", "app"]);

/**
 * Whether `url` is a Canny-hosted board by its HOST alone (`{brand}.canny.io`).
 * Canny custom domains (feedback.acme.com) are NOT detectable this way — those are
 * recognised by the state island being present, which is why parsing never depends
 * on this predicate.
 */
export function isCannyHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host.endsWith(".canny.io")) return false;
  const label = host.slice(0, -".canny.io".length);
  return label.length > 0 && !label.includes(".") && !CANNY_RESERVED.has(label);
}

/**
 * Pull `window.__data` out of a Canny page. Returns null when the marker is absent
 * or the payload does not parse — the caller treats that as "not a Canny page",
 * never as "an empty board".
 */
export function extractStateIsland(html: string): Record<string, unknown> | null {
  const marker = /window\.__data\s*=\s*/.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== "{") return null;

  // Brace scan that skips over string literals, so a `{` inside a post title cannot
  // unbalance the object.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  // The only non-JSON token Canny emits is a bare `undefined` in value position.
  // Anchoring on the preceding `:`/`,`/`[` keeps the substitution to value slots.
  const json = html.slice(start, end + 1).replace(/([:,[]\s*)undefined\b/g, "$1null");
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rec(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/**
 * Whether the island shows at least one PUBLIC board. A Canny page whose boards are
 * all private/custom-access renders without posts; without this check that page would
 * look like an empty portal instead of a closed one.
 */
function hasPublicBoard(island: Record<string, unknown>): boolean {
  const items = rec(rec(island.boards)?.items);
  if (!items) return false;
  return Object.values(items).some((b) => str(rec(rec(b)?.settings)?.access) === "public");
}

/** Build the public permalink of a post: {origin}/{board}/p/{post}. */
function postUrl(origin: string, post: Record<string, unknown>, urlName: string): string | null {
  const board = str(rec(post.board)?.urlName);
  if (!board || !urlName) return null;
  return `${origin}/${board}/p/${urlName}`;
}

function toEntry(origin: string, post: unknown, urlName: string): RoadmapEntry | null {
  const p = rec(post);
  if (!p) return null;
  const id = str(p._id);
  const title = str(p.title);
  const status = str(p.status).toLowerCase();
  if (!id || !title || !status) return null;
  return {
    id,
    title,
    status,
    votes: typeof p.score === "number" && Number.isFinite(p.score) ? Math.max(0, p.score) : 0,
    url: postUrl(origin, p, urlName),
  };
}

/**
 * Parse a Canny board/roadmap page into a portal.
 *
 * The roadmap root (`{brand}.canny.io/`) carries `roadmap.posts` — ordered refs into
 * `posts[boardId][urlName]` — which is the columns view (planned / in progress /
 * complete). A single board page carries no `roadmap` key, so we fall back to
 * flattening `posts` itself; both paths yield the same entry shape.
 */
export function parseCannyPortal(html: string, url: string): RoadmapParse {
  const island = extractStateIsland(html);
  if (!island) return { ok: false, reason: "unparsable" };

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { ok: false, reason: "unparsable" };
  }

  const postsByBoard = rec(island.posts) ?? {};
  const roadmap = rec(island.roadmap);
  const entries: RoadmapEntry[] = [];
  const seen = new Set<string>();

  const push = (post: unknown, urlName: string) => {
    const entry = toEntry(origin, post, urlName);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  };

  const refs = roadmap?.posts;
  if (Array.isArray(refs)) {
    for (const raw of refs) {
      const ref = rec(raw);
      if (!ref) continue;
      const urlName = str(ref.postURLName);
      push(rec(postsByBoard[str(ref.boardID)])?.[urlName], urlName);
    }
  } else {
    for (const board of Object.values(postsByBoard)) {
      for (const [urlName, post] of Object.entries(rec(board) ?? {})) push(post, urlName);
    }
  }

  if (entries.length === 0) {
    // A closed board renders the same shell as an empty one, so the board settings —
    // not the absence of posts — are what tell them apart.
    return { ok: false, reason: hasPublicBoard(island) ? "empty" : "private" };
  }

  return {
    ok: true,
    portal: { vendor: "canny", url, entries, truncated: roadmap?.hasNextPage === true },
  };
}
