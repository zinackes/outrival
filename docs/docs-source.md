# `docs` source — a competitor's technical roadmap

## Why

Outrival already reads what a competitor **says** (homepage, blog, news) and what it
**sells** (pricing, jobs). It did not read what a competitor is **building for
developers** — and that surface is the earliest honest artefact of a roadmap:

- a new endpoint is documented **before** it is announced,
- a `deprecated: true` flag is a sunset decision made months earlier,
- a `[beta]` / `/v2beta/` path is a launch in flight.

Before this source, the only way to watch that was a `custom` monitor on one docs
page: one page, lexical diff, no structure.

## The two modes

Structured-first, same doctrine as the staged extraction pipeline: the cheap,
deterministic path first, the coarse one as the floor.

### Mode 1 — an OpenAPI / Swagger spec is published (the jackpot)

The scraper flattens the spec into a **canonical, sorted, one-fact-per-line
document**:

```
Developer API documentation for acme.com — the endpoints, parameters and data models…
OpenAPI "Acme API" v2024-06-01 — 128 endpoints (3 deprecated, 2 beta), 64 schemas
GET /v1/charges — API endpoint [DEPRECATED — the vendor is sunsetting this capability] (params: expand, limit)
POST /v1/payment_intents/{id}/capture — API endpoint (params: amount_to_capture, id)
schema Charge — data model fields: amount, currency, legacy_source [DEPRECATED], status
```

Because the document is canonical, **the pipeline's ordinary lexical differ produces a
structural delta**: an added endpoint is exactly one `+` line, a field turning
`deprecated` rewrites exactly its schema line into a `-`/`+` pair. There is **zero AI
in the diff** — AI is paid only downstream, for the "so what" (classify → signal).

Sorting is the guarantee, not a nicety: a spec served in hash order would otherwise
fake a full-document rewrite on every scrape. `docs.test.ts` pins this.

Both JSON and YAML specs are read (the `yaml` dependency). `parseSpec` is deliberately
strict — the body must declare `openapi`/`swagger` **and** carry `paths`, so a
`package.json` or a docs config sitting at `/openapi.json` can never pin the source
into a hollow structured snapshot.

**Caps** (`MAX_OPERATIONS` 1500, `MAX_SCHEMAS` 400, `MAX_FIELDS_PER_SCHEMA` 60) keep a
Stripe-class spec inside the 50 KB `diffText` budget. Every truncation is **counted in
the header line** — a capped spec never looks like a complete one.

### Mode 2 — HTML docs only

No spec → the docs **sitemap** is the broadest structured surface they expose. The
snapshot is the sorted list of URLs under the docs root (`filterDocsUrls` drops the
blog/pricing/careers noise a site-wide sitemap carries), so a brand-new page reads as
a newly documented capability — the same signal mode 1 reads off an added endpoint,
one abstraction up.

On top of that, the top-K pages get a **content fingerprint** so a *rewritten* page
(a changed rate limit, a removed guarantee, a new auth requirement) surfaces too:

```
page https://docs.acme.com/getting-started — documented content fingerprint 9f2ab41c0d3e
```

- The hash is taken over `extractContent` output — the exact text the pipeline diffs —
  so a build id, a CSP nonce or a rotating banner cannot churn it.
- Selection is **deterministic** (shallowest path, then lexicographic); a drifting
  selection would fake "changed" lines on untouched pages.
- A page that fails to fetch emits **no line** — never a placeholder hash, which the
  next successful run would diff as a change that never happened.
- Kill-switch `DOCS_PAGE_HASH_ENABLED=false`, size `DOCS_PAGE_HASH_MAX` (default 20).

Accepted limitation: a brand-new **shallow** page can displace the Kth hashed page,
showing as one stray removed fingerprint line next to the genuine new-page line.
Bounded and visible, and far cheaper than hashing every page.

## Docs-root discovery

Cheapest first, and it stops at the first hit:

1. The URL we were handed is **already** a docs surface (`looksLikeDocsUrl`) → used
   verbatim. This is what makes the user's optional URL override authoritative:
   scrape-monitor passes `monitor.config.url ?? competitor.url`, and re-probing
   `docs.<domain>` after the user pointed us somewhere would monitor the wrong thing.
   It also handles API-first companies whose site root genuinely is `api.acme.com`.
2. Developer **subdomains**: `docs.` · `developers.` · `developer.` · `api.` ·
   `apidocs.` · `devdocs.` (HEAD probe, GET fallback on 405/501, soft-404 guard).
3. Conventional **paths**: `/docs` · `/documentation` · `/api-reference` ·
   `/api-docs` · `/reference` · `/developers` · `/developer` · `/api`.
4. A **nav/footer link** on the homepage — one L0 GET, only reached when everything
   conventional missed (a docs site under a bespoke route like `/handbook` is only ever
   discoverable this way). Same-registrable-domain links only: following an off-domain
   "Documentation" link would monitor a third party.

## The mode-flip guard (the load-bearing detail)

If run *N* resolves mode 1 and run *N+1* silently drops to mode 2, the lexical diff
reads **"every line removed, every line added"** — one enormous phantom signal, and the
real API delta is lost inside it.

So a spec probe only counts as a **negative** on a *definitive* answer: a 4xx, or a 200
whose body is not a spec. Any transient failure (5xx / timeout / network) with no spec
found throws `docs: spec_probe_failed` and is retried instead of degrading. The
resolved mode is also **named in the header line**, so a genuine mode change is at
least readable in the diff rather than arriving unexplained.

## Failure vocabulary

| Thrown message | Meaning | UI state |
|---|---|---|
| `docs: no_docs_surface` | No docs subdomain, no conventional path, no homepage link. They publish no public developer docs. | `not_available` — neutral (`NO_TARGET_MARKERS`), never styled as a failure |
| `docs: no_docs_index` | Docs exist but expose neither a spec nor an enumerable sitemap. | `fixable` — **actionable**: the user can point us at a better URL |
| `docs: spec_probe_failed` | A spec probe failed transiently; we refuse to guess. | retried, then the usual 3-strike path |

The `no_docs_surface` / `no_docs_index` split is deliberate. Calling "we couldn't index
their docs" a neutral absence would hide an actionable gap behind reassuring copy.

## Wiring (what a new source touches)

- Enum ↔ constant: `sourceTypeEnum` (`packages/db/src/schema/monitors.ts`) +
  `SOURCE_TYPES` (`packages/shared/src/constants/sources.ts`), migration `0048`.
- Gating: `PLAN_LIMITS.allowedSources` for **pro** and **business** →
  `minPlanForSource("docs") === "pro"` drives the paywall copy for free.
- Catalog: `CONFIGURABLE_SOURCES.developer` (the Sources page row, and what the enable
  route accepts via `isConfigurableSource`).
- Weekly by default (`defaultFrequencyFor`): docs move on release cycles, and a run
  costs a sitemap walk plus a capped page batch.
- `apps/workers/src/core/scrape-monitor.ts`: `SIZE_VARIABLE_SOURCES` (docs grow — a
  shorter run must not be graded `partial`) and `SYNTHETIC_DOC_SOURCES` (the capture is
  always synthesised, so the deny-page copy heuristic is meaningless on it). **No
  branch** — `docs` rides the generic diff path.
- `LIST_SHAPED_SOURCES` (`packages/ai/src/tasks/cosmetic-gate.ts`): both modes are list
  deltas. "Did the wording change?" is meaningless on a new endpoint, and the gate
  could only ever suppress a real discovery.

## Deliberately out of scope

- **Per-platform adapters** (Mintlify / Docusaurus / Redoc). The generic sitemap mode
  covers them; a platform matrix would be maintenance with no extra signal.
- **A `docsUrl` on `PlatformProfile`** (patch-31) so detection caches the docs root —
  a clean follow-up, not needed here.
- **A `docs` data tab.** Nothing is extracted into a table, so the surface is Signals
  plus the Sources row.
- **Real per-page content diffs** in mode 2 (fingerprints only) — that would be a
  second diff pipeline inside the scraper.
