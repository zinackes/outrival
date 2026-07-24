import type { RoadmapEntry, RoadmapParse } from "./types";

/**
 * ProductBoard Portal adapter.
 *
 * Unlike Canny, the portal page itself is an empty SPA shell — a 340 KB document
 * that renders one character of text — so there is nothing to read at L0 and nothing
 * a lexical diff could ever see. Its own frontend, however, reads a single
 * UNAUTHENTICATED endpoint: `GET /api/portal/all`, scoped by an `x-portal-path`
 * header rather than a query string or a session cookie. That header value is just
 * the portal's own path, so the whole integration is one plain GET — no browser, no
 * credentials, no AI.
 *
 * The response carries `portalCards` (with `portalVotesCount`), `portalTabs` (the
 * columns, which ARE the statuses — they are named by the portal owner, not drawn
 * from a fixed vocabulary) and `portalCardAssignments` joining the two.
 */

export const PORTAL_HOST = "portal.productboard.com";
export const PORTAL_API_URL = `https://${PORTAL_HOST}/api/portal/all`;

/**
 * Path segments that are portal ROUTES rather than part of the portal's identity —
 * a URL copied from the address bar usually points at a tab or a card.
 */
const ROUTE_SEGMENTS = new Set(["tabs", "c", "f", "features", "submit-idea", "ideas"]);

export interface ProductboardTarget {
  /** Value of the `x-portal-path` header, e.g. "pb/1-productboard-portal". */
  portalPath: string;
  /** Canonical portal URL (origin + portalPath). */
  url: string;
}

/**
 * Recognise a ProductBoard portal URL and extract the portal path. The path is the
 * leading segments of the URL up to the first route keyword, capped at two —
 * `/{space}/{portal}` is the shape ProductBoard mints.
 */
export function matchProductboardPortal(raw: string): ProductboardTarget | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() !== PORTAL_HOST) return null;

  const segments: string[] = [];
  for (const seg of u.pathname.split("/")) {
    if (!seg) continue;
    if (ROUTE_SEGMENTS.has(seg.toLowerCase())) break;
    segments.push(seg);
    if (segments.length === 2) break;
  }
  if (segments.length === 0) return null;

  const portalPath = segments.join("/");
  return { portalPath, url: `${u.origin}/${portalPath}` };
}

function rec(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/**
 * Whether the payload says the portal is closed.
 *
 * Only the two UNAMBIGUOUS flags are read. `portals[].visibility` is an opaque
 * numeric enum whose mapping is not published; treating an unknown value as private
 * would silently stop monitoring a portal that is in fact public, which is the more
 * damaging mistake. A genuinely closed portal is also refused at the HTTP layer
 * (403 "Invalid space or portal"), which the scraper handles separately.
 */
function isClosedPortal(payload: Record<string, unknown>): boolean {
  if (rec(payload.config)?.publiclyAccessible === false) return true;
  return rec(arr(payload.portals)[0])?.enforceJwtToken === true;
}

/** Parse an `/api/portal/all` payload into a portal. Pure. */
export function parseProductboardPortal(
  payload: unknown,
  target: ProductboardTarget,
): RoadmapParse {
  const root = rec(payload);
  if (!root) return { ok: false, reason: "unparsable" };
  if (isClosedPortal(root)) return { ok: false, reason: "private" };

  const tabNames = new Map<string, string>();
  for (const raw of arr(root.portalTabs)) {
    const tab = rec(raw);
    const id = str(tab?.id);
    const name = str(tab?.name);
    if (id && name) tabNames.set(id, name.toLowerCase());
  }

  // A card only appears on the portal through an assignment, and the assignment's
  // tab is its status. An unassigned card is not on the roadmap at all.
  const statusByCard = new Map<string, string>();
  for (const raw of arr(root.portalCardAssignments)) {
    const a = rec(raw);
    const status = tabNames.get(str(a?.portalTabId));
    const cardId = str(a?.portalCardId);
    if (status && cardId && !statusByCard.has(cardId)) statusByCard.set(cardId, status);
  }

  const entries: RoadmapEntry[] = [];
  for (const raw of arr(root.portalCards)) {
    const card = rec(raw);
    const id = str(card?.id);
    const title = str(card?.name);
    const status = statusByCard.get(id);
    if (!id || !title || !status) continue;
    const slug = str(card?.slug);
    const votes = card?.portalVotesCount;
    entries.push({
      id,
      title,
      status,
      votes: typeof votes === "number" && Number.isFinite(votes) ? Math.max(0, votes) : 0,
      url: slug ? `${target.url}/c/${slug}` : null,
    });
  }

  if (entries.length === 0) {
    // Tabs but no cards is a real, empty portal; no tabs at all means the payload is
    // not the portal document we expect.
    return { ok: false, reason: tabNames.size > 0 ? "empty" : "unparsable" };
  }

  // `/api/portal/all` returns the whole portal in one response — there is no paging
  // signal to propagate, unlike Canny's roadmap.
  return { ok: true, portal: { vendor: "productboard", url: target.url, entries, truncated: false } };
}
