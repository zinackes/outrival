# AI Visibility — the near-zero-cost strategy

Companion to `docs/ai-visibility.md`. That doc specs the feature; this one is about the
**operator cost**: how to run "share of model" tracking for tracked orgs at ≈ $0, and
where the paid surfaces are (and how to push their cost onto the customer, not us).

## The cost model — one line matters

The pipeline is `for each (prompt × engine): query engine once → parse the answer`.

- **The parse is already free.** `extract-ai-visibility` runs on the internal AI provider
  pool (Cerebras/Groq free tiers, patch-22), so the roster-matching call costs $0.
- **The only paid part is the engine query.** Everything below is about making that free.

## The engine tiers (cheap → paid)

`Engine` (`apps/workers/src/lib/ai-visibility/engines.ts`) is a tiered abstraction. Each
engine is best-effort: no key → `queryEngine` returns null → the run skips it. So the
default configuration (Gemini key only) costs nothing.

### Tier 0 — Gemini + Google Search grounding (FREE, official, shipped)

The default engine: a web-grounded answer with citations that stands in for "Google's AI
answer", the single biggest AI-answer surface. **Read the tier grid carefully. An earlier
version of this doc had it wrong, and that error is what kept the engine down for eleven
days.**

| | Free tier (no card) | Tier 1 (card on file) |
|---|---|---|
| `gemini-2.5-flash` / `-flash-lite` grounded | **500 RPD free** (the two share the cap) | 1,500 RPD free, then $35/1k |
| `gemini-3.x` grounded | **Not available** | 5,000 prompts/month free, then $14/1k |

The "~5,000 free prompts/month" figure belongs to the **paid** tier. On the free tier the
published budget is 500 grounded requests per DAY, on 2.5 Flash only.

**But the published number is not the one that binds.** The per-model request cap applies
first, and AI Studio reported this for our free-tier project on 2026-07-25:

```
Gemini 2.5 Flash    RPM 7/5    TPM 196/250K    RPD 27/20
```

**5 requests per minute, 20 per day.** Not 500. One product at `AI_VISIBILITY_MAX_PROMPTS=10`
plus a 3-prompt onboarding teaser already spends 13 of the 20, and a second product finishes
the day's budget before the run ends. Always read the console (`aistudio.google.com/rate-limit`)
rather than the pricing page before sizing anything here.

That ceiling is the real constraint on this feature, and it does not scale: at ~2 products
per org, the free tier tops out around **one org per day**. Options, in order of what they
cost us: move the project to Tier 1 (a card on file, 1,500 grounded RPD still free, so $0
until the allowance is passed), cut `AI_VISIBILITY_MAX_PROMPTS`, or lean on the parametric
engine below, which answers from the internal pool and has no Gemini quota at all.

Two traps follow from that grid, and we hit both. **Never pin a `-latest` alias**: the
allowance is granted per MODEL, the alias drifted onto a 3.x generation that has none on
the free tier, and every grounded call came back 429 (outage 13/07 to 24/07/2026, zero
rows written, 72 requests used out of the allowance). And the free tier caps requests per
MINUTE as well, so an unpaced prompt set 429s from the 11th call on, which reads exactly
like a spent allowance. `AI_VISIBILITY_MIN_REQUEST_GAP_MS` paces the calls, and the engine
client only drops an engine when the 429 names a per-day quota.

ToS-clean (official API). `GEMINI_API_KEY` + `AI_VISIBILITY_GEMINI_MODEL`.

### Tier 0b — Parametric ("share of model", FREE)

Ask the same buyer-intent prompts to the free pool models (Cerebras/Groq) with **no web
grounding** → what the model recalls from *training* = literal share-of-*model*. A
distinct, meaningful metric (training-data presence vs live-search presence), $0 because
it reuses the existing pool. *(Not yet wired as an engine — small follow-up: a
`parametric` engine that calls `complete()` with no grounding.)*

### Tier 1 — Scrape-cascade for Google AI Overviews (FREE-ish, ambitious, phase 2)

**Our structural advantage.** There is **no public API for Google AI Overviews**; the
only way to see what a user sees is to capture the whole SERP surface, and Google runs
the most aggressive anti-automation on the public web. SERP vendors (SerpApi, AWR) sell
exactly this. **But the collection doctrine (2026-07-14) rules out scraping Google's
SERP directly**: Google disallows `/search` in robots.txt and challenges bots, which we
now treat as a **refusal** — we stop, we don't bypass it. So the doctrine-compatible path
is the free grounded-model route below (Gemini), **not** SERP scraping. A browser render
only helps where a surface is served openly; it is no longer an anti-automation tool.

Caveats, stated honestly: scraping Google SERP is **ToS-gray** and operationally the
hardest target (Google's anti-bot > any competitor site). Treat it as the ambitious
free path for surfaces that have no free API (pure ChatGPT consumer, AIO), *after* the
free Gemini engine covers the easy 80%.

### Tier 2 — Perplexity Sonar / OpenAI / SerpApi (PAID, opt-in)

Only run when a key is present. Never the default.

## The three levers that keep operator cost ≈ $0

1. **BYOK (bring-your-own-key).** Let pro/business customers plug in *their own*
   Perplexity/OpenAI/SerpApi key for the paid engines → the spend is **the customer's,
   not ours**. Default engines (Gemini free + parametric) need no customer key. Competing
   tools charge $150/mo *and* eat the API cost; we ship the free engines by default and
   offer paid engines as BYOK. *(Schema: a per-org `ai_visibility_keys` row, or reuse the
   settings/integrations surface. Not yet built.)*
2. **Cross-tenant scrape/query dedup.** A prompt like "best CRM 2026" is org-agnostic:
   query/scrape it **once**, then parse the one answer against each org's roster. Cost
   becomes **sub-linear** in org count (prompts overlap heavily within a sector). *(Needs
   a shared answer cache keyed by (normalized prompt, engine, locale, day).)*
3. **Budget by free quota, not by dollars.** The ceiling to stay under is a DAILY one
   (500 grounded requests on the free tier), so what matters is how many products a
   single day's runs touch, not the monthly sum. `AI_VISIBILITY_MAX_PROMPTS` bounds the
   per-org volume and the weekly interval spreads the load; if a day ever gets tight,
   spread the scheduler further before reaching for a paid tier.

## Status

- **Shipped:** `gemini` engine (Tier 0), free by default; `TREND_ENGINE`/UI default → gemini.
  Activate with a free AI Studio `GEMINI_API_KEY` + `AI_VISIBILITY_ENABLED=true` + the
  weekly schedule — no paid dependency.
- **Next (phase 2):** parametric engine (Tier 0b), cross-tenant answer cache (lever 2),
  BYOK for paid engines (lever 1), scrape-cascade AIO engine (Tier 1).

## Sources (2026)

- Gemini pricing / free grounding quota: https://ai.google.dev/gemini-api/docs/pricing
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Google Search grounding: https://ai.google.dev/gemini-api/docs/google-search
- No public AIO API / capture-the-surface: https://www.searchenginejournal.com/google-aio-track-visibility-serpapi-spcs/560470/
- SERP-vendor AIO tracking (the paid alternative we replace): https://serpapi.com/ai-overview
- AI-search brand-tracking market ($150/mo tools): https://otterly.ai/
