# Plan 007: Guard the worker-side scraper fetch paths against SSRF (patch-32 sources + redirect re-validation)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report. When done, update this plan's row in
> `plans/README.md` unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- packages/scrapers/src packages/shared/src/monitor-url.ts`
> If any in-scope file changed, compare against the "Current state" excerpts before
> proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent; pairs well after 005/006 so tests run)
- **Category**: security
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

Outrival fetches URLs discovered inside competitor-controlled content. The API path
(`packages/scrapers/src/lib/quick-fetch.ts`) already defends against SSRF: it validates
every URL with `validatePublicUrl` and follows redirects **manually**, re-checking each
hop. Three newer worker-side scrapers (patch-32) bypass that guard entirely — they call
raw `fetch()` on URLs taken verbatim from a competitor's `robots.txt`, RSS `<link>`, or
platform-profile value, with `redirect: "follow"`. A competitor (or anyone who can get a
domain added as a "competitor") can serve content pointing the worker at
`http://169.254.169.254/…` or in-cluster services (Postgres/Redis/metadata). This is a
regression of a previously-fixed SSRF class. This plan routes the unguarded fetches
through one shared, hop-revalidating helper.

## Current state

**The existing guard** — `packages/shared/src/monitor-url.ts:51`:
```ts
export function validatePublicUrl(raw: string): MonitorUrlValidation {
  // returns { ok: true; url: string } | { ok: false; error: string }
  // rejects: non-http(s), credentials in URL, non-80/443 port, IP literals,
  //          internal hosts (localhost/.local/.internal/single-label/10.x/… via isUnsafeHost)
}
```

**The reference correct pattern** — `packages/scrapers/src/lib/quick-fetch.ts:30-55`:
```ts
const MAX_REDIRECTS = 5;
export async function quickFetch(url: string): Promise<QuickFetchResult> {
  let target = url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    const safe = validatePublicUrl(target);
    if (!safe.ok) throw new Error(`quickFetch: unsafe_url (${safe.error})`);
    res = await fetch(target, { ..., redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`quickFetch: too_many_redirects for ${url}`);
      target = new URL(location, target).toString();
      continue;
    }
    break;
  }
  ...
}
```

**The unguarded fetches** (raw `fetch`, no `validatePublicUrl`, `redirect: "follow"`):

1. `packages/scrapers/src/changelog/changelog.scraper.ts:36-55` — `fetchFeed(feedUrl)`;
   `feedUrl` comes from `discoverFeedUrl` reading the competitor page's
   `<link rel="alternate" href="…">`. Returns `FeedItem[] | null`.
2. `packages/scrapers/src/sitemap/sitemap.scraper.ts:16-34` — `fetchBytes(url)`; used for
   `${origin}/robots.txt`, the `Sitemap:` URLs parsed out of it, and every nested
   `<sitemapindex><loc>` URL. Returns `Uint8Array | null`.
3. `packages/scrapers/src/status/status.scraper.ts:96-104` — `fetch(summaryUrl)` where
   `summaryUrl` is built from `resolveHost(url, platformProfile.statusPage.value)`; the
   `statuspage:<host>` value originates in scraped HTML. Throws on `!res.ok`.

**Other `redirect: "follow"` sites on user/competitor-derived URLs** (same class, lower
priority — fix in Step 4):
- `packages/scrapers/src/lib/scrape-direct.ts:12-16` (L0 direct fetch)
- `packages/scrapers/src/lib/conditional-fetch.ts:30-35` (pre-flight conditional GET)
- `packages/scrapers/src/pricing/discover-url.ts:113,159`
- `packages/scrapers/src/discovery/discover.ts:166`
- `packages/scrapers/src/tech-stack/scraper.ts:31`
- `packages/scrapers/src/alternatives/generate.ts:114`
- `packages/scrapers/src/backfill/wayback.ts:89` — **do NOT change** (fetches the
  Wayback Machine's own fixed host `web.archive.org`, not a competitor-derived URL; see
  Out of scope).

`packages/scrapers` may import `@outrival/shared` (allowed by the monorepo layering
rules), so `validatePublicUrl` is reachable from all these files. `changelog`/`sitemap`
already import from `@outrival/shared` elsewhere.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Scraper tests | `cd packages/scrapers && bun test src` | all pass (incl. new tests) |
| Full suite | `pnpm test` | exit 0 |

(If plan 005 has not landed, the scrapers `test` script may not include `src` — run the
explicit dirs plus your new test file. Prefer landing 005 first.)

## Scope

**In scope**:
- `packages/scrapers/src/lib/guarded-fetch.ts` (create — the shared helper)
- `packages/scrapers/src/changelog/changelog.scraper.ts`
- `packages/scrapers/src/sitemap/sitemap.scraper.ts`
- `packages/scrapers/src/status/status.scraper.ts`
- `packages/scrapers/src/lib/scrape-direct.ts`
- `packages/scrapers/src/lib/conditional-fetch.ts`
- `packages/scrapers/src/pricing/discover-url.ts`
- `packages/scrapers/src/discovery/discover.ts`
- `packages/scrapers/src/tech-stack/scraper.ts`
- `packages/scrapers/src/alternatives/generate.ts`
- `packages/scrapers/src/lib/guarded-fetch.test.ts` (create)

**Out of scope** (do NOT touch):
- `packages/scrapers/src/backfill/wayback.ts` — its `fetch` targets the fixed
  `web.archive.org` host, not competitor-derived input; re-validating it adds nothing.
- `packages/scrapers/src/lib/quick-fetch.ts` — already correct; it is the reference.
- The browser cascade (`scrape-patchright.ts`, Camoufox) — Patchright manages its own
  navigation; this plan is about raw `fetch()` paths only.
- Behavior of the parsers (feed/sitemap/status rendering) — only the fetch is changing.

## Git workflow

- Branch: `advisor/007-scraper-ssrf-guard`
- Commit per logical unit (helper + tests, then the three patch-32 scrapers, then the
  remaining redirect sites). Conventional: `fix(scrapers): guard SSRF on worker fetch paths`.
- Do NOT push unless instructed.

## Steps

### Step 1: Create the shared guarded-fetch helper

Create `packages/scrapers/src/lib/guarded-fetch.ts` exporting a `safeFetch` that mirrors
`quickFetch`'s manual-redirect + per-hop `validatePublicUrl` loop, but is generic over
what it returns (callers need `Response`, not `quickFetch`'s HTML/text shape). Target shape:

```ts
import { validatePublicUrl } from "@outrival/shared";

const MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  accept?: string;
}

/**
 * SSRF-safe fetch for URLs derived from scraped/competitor-controlled content.
 * Validates every hop with validatePublicUrl and follows redirects MANUALLY so an
 * initially-public host can't 3xx toward an internal IP. Throws on an unsafe URL or
 * too many redirects; returns the final Response (which may be !ok — callers decide).
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop++) {
    const safe = validatePublicUrl(target);
    if (!safe.ok) throw new Error(`safeFetch: unsafe_url (${safe.error})`);
    const res = await fetch(target, {
      headers: opts.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`safeFetch: too_many_redirects for ${url}`);
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Route the three patch-32 scrapers through `safeFetch`

For each, replace the raw `fetch(..., { redirect: "follow" })` with `safeFetch(url, {...})`,
preserving the existing headers, timeout, and **error semantics**:

- `changelog.scraper.ts` `fetchFeed`: keep the `try/catch → return null` and the
  `!res.ok → return null` behavior. `safeFetch` throwing on an unsafe URL must be caught
  by the existing `catch` and yield `null` (unsafe feed URL = no feed, best-effort).
- `sitemap.scraper.ts` `fetchBytes`: same — `try/catch → return null`, `!res.ok → null`.
  An unsafe robots/sitemap URL becomes `null` (skipped), which the caller already handles.
- `status.scraper.ts` `scrape`: it currently `throw`s on `!res.ok`. Keep throwing; an
  unsafe host now also throws (via `safeFetch`) with a clear `unsafe_url` message, which
  the job's failure path already logs to `scrape_runs`.

Keep the existing `AbortController`/timeout intent (pass `timeoutMs` to `safeFetch`;
drop the now-redundant local `AbortController` where `safeFetch`'s own timeout replaces it).

**Verify**: `pnpm typecheck` → exit 0. `cd packages/scrapers && bun test src/changelog src/sitemap src/status` (or `bun test src`) → all pass.

### Step 3: Add tests for the helper

Create `packages/scrapers/src/lib/guarded-fetch.test.ts`. Model structure after an
existing scraper test (e.g. `packages/scrapers/src/lib/*.test.ts`). Cover, without real
network — inject/stub `fetch` (Bun: `globalThis.fetch = mock(...)` and restore in
teardown, or pass a fetch impl if you refactor `safeFetch` to accept one; prefer the
global mock to keep the signature simple):
- an internal host (`http://169.254.169.254/`, `http://localhost/`) → **throws** `unsafe_url`;
- a public host that returns a 302 `Location` pointing to an internal host → **throws**
  on the second hop (redirect re-validation);
- a public host returning 200 → returns the `Response`;
- more than `MAX_REDIRECTS` public→public redirects → **throws** `too_many_redirects`.

**Verify**: `cd packages/scrapers && bun test src/lib/guarded-fetch.test.ts` → all pass.

### Step 4: Route the remaining competitor-derived redirect sites through `safeFetch`

Convert the `redirect: "follow"` fetches in `scrape-direct.ts`, `conditional-fetch.ts`,
`pricing/discover-url.ts` (both sites), `discovery/discover.ts`, `tech-stack/scraper.ts`,
and `alternatives/generate.ts` to `safeFetch`, preserving each call's current return/error
handling and headers. `scrape-direct.ts` inspects `res.status` for 403/503/challenge
branches — keep that logic; `safeFetch` returns the final `Response` unchanged so those
branches still work (it only throws on an *unsafe URL* or too many redirects, both of
which should propagate as a scrape failure).

Do **not** touch `wayback.ts` (out of scope).

**Verify**: `pnpm typecheck` → exit 0. `cd packages/scrapers && bun test src` → all pass.

## Test plan

- New: `packages/scrapers/src/lib/guarded-fetch.test.ts` (cases in Step 3) — the core
  regression guard for this fix (internal host + redirect-to-internal both rejected).
- Existing scraper tests must stay green (parsers unchanged; only the fetch wrapper moved).
- Verification: `cd packages/scrapers && bun test src` → all pass including the new file.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `cd packages/scrapers && bun test src` passes, including `guarded-fetch.test.ts`
- [ ] `grep -rn 'redirect: "follow"' packages/scrapers/src` returns **only** `backfill/wayback.ts`
- [ ] No raw `fetch(` on a competitor/robots/feed/status-derived URL remains in the
      three patch-32 scrapers (they call `safeFetch`)
- [ ] Only in-scope files modified (`git status`); `wayback.ts` and `quick-fetch.ts` untouched
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Removing the local `AbortController` in a scraper changes a test's expectation you
  can't reconcile — report rather than rewriting the test.
- A scraper depends on following a redirect to a *different registrable domain* as
  normal behavior (e.g. a status page hosted on a vendor domain) and `validatePublicUrl`
  would still allow it (it allows any public host) — confirm the public-host redirect
  still works; if a legitimate flow breaks, STOP and report which.
- `validatePublicUrl`'s signature or return shape differs from the excerpt (drift).

## Maintenance notes

- Any **new** scraper that fetches a URL derived from scraped content must use
  `safeFetch` — add that to `packages/scrapers/CLAUDE.md` conventions in a follow-up.
- Known residual gap (documented, out of scope): DNS-rebinding is not covered by a
  syntactic host check — that's an egress-level control, same limitation `quickFetch`
  notes. Do not attempt DNS resolution here.
- Reviewer should confirm every converted call preserved its original error contract
  (return `null` vs `throw`), since the scrapers' callers rely on it.
