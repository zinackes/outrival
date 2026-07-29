/**
 * Every JSON payload a page embeds, whatever framework hid it there.
 *
 * Feedback portals are near-universally JS apps that server-render their state into
 * the HTML, and there are only a handful of places they put it: a JSON `<script>`
 * (Next pages router, Remix), the RSC flight stream (Next app router), or a
 * `window.__something = {…}` assignment (Canny, Nuxt). Reading those is what lets one
 * generic adapter cover vendors we have never named — with no browser and no AI.
 *
 * Everything here is a pure function of the HTML. Deciding whether a payload actually
 * describes a roadmap is `generic.ts`'s job, not this module's: this one only answers
 * "what JSON is on this page", and answers it permissively.
 */

/** Stop walking a pathological page rather than pin a worker to it. */
const MAX_ISLANDS = 500;
const MAX_ISLAND_CHARS = 4_000_000;

/**
 * Slice out the object literal starting at `start`, skipping over string literals so
 * a `{` inside a title cannot unbalance the scan. Returns null when `start` is not a
 * `{` or the object never closes.
 */
export function scanObjectLiteral(source: string, start: number): string | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

/**
 * JSON.parse, tolerating the one non-JSON token these islands actually contain: a
 * bare `undefined` in value position (Canny serialises absent cookies that way).
 * Anchoring on the preceding `:`/`,`/`[` keeps the substitution to value slots.
 */
export function parseLooseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // fall through to the tolerant pass
  }
  try {
    return JSON.parse(raw.replace(/([:,[]\s*)undefined\b/g, "$1null")) as unknown;
  } catch {
    return null;
  }
}

/** `<script type="application/json">…</script>` — Next's `__NEXT_DATA__` and friends. */
function jsonScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const body = m[1];
    if (body && body.length <= MAX_ISLAND_CHARS) out.push(body);
  }
  return out;
}

/** `window.__data = {…}`, `window.__NUXT__ = {…}` — anything assigned to a global. */
function globalAssignments(html: string): string[] {
  const out: string[] = [];
  const re = /(?:window|self|globalThis)\.__[A-Za-z0-9_$]+\s*=\s*/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const raw = scanObjectLiteral(html, m.index + m[0].length);
    // A non-`{` right-hand side (Nuxt's `(function(a,b){…}(…))` IIFE) yields null and
    // is skipped: it is code, not data, and running it is not something we do.
    if (raw && raw.length <= MAX_ISLAND_CHARS) out.push(raw);
  }
  return out;
}

/**
 * The React Server Components flight stream: `self.__next_f.push([1,"<chunk>"])`,
 * where each chunk is a JS string literal holding one slice of a newline-delimited
 * stream. Concatenated and de-escaped, its lines are `<ref>:<json>` — so stripping
 * the reference prefix turns most lines back into parseable JSON documents.
 *
 * This is the only way to read a Next app-router portal without a browser, and app
 * router is what new portals ship on.
 */
function flightDocuments(html: string): string[] {
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const start = m.index + m[0].length;
    if (html[start] !== '"') continue;
    // The chunk is a JSON string literal; find its end the same way as an object.
    let end = -1;
    let escaped = false;
    for (let i = start + 1; i < html.length; i++) {
      const c = html[i];
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    const decoded = parseLooseJson(html.slice(start, end + 1));
    if (typeof decoded === "string") chunks.push(decoded);
  }
  if (chunks.length === 0) return [];

  const stream = chunks.join("");
  const out: string[] = [];
  for (const line of stream.split("\n")) {
    // `2:I[…]`, `a:{…}`, `13:["$","div",…]` — a hex reference, an optional one-letter
    // tag, then the payload. Anything else on the line is not a document.
    const m = /^[0-9a-f]+:[A-Za-z]?(?=[[{])/.exec(line);
    if (!m) continue;
    const body = line.slice(m[0].length);
    if (body.length <= MAX_ISLAND_CHARS) out.push(body);
  }
  return out;
}

/**
 * Every JSON document embedded in `html`, parsed. Unparseable candidates are dropped
 * silently — a page is allowed to contain scripts that are not data.
 */
export function collectJsonIslands(html: string): unknown[] {
  const raw = [...jsonScripts(html), ...globalAssignments(html), ...flightDocuments(html)];
  const out: unknown[] = [];
  for (const candidate of raw) {
    if (out.length >= MAX_ISLANDS) break;
    const parsed = parseLooseJson(candidate);
    if (parsed !== null && typeof parsed === "object") out.push(parsed);
  }
  return out;
}
