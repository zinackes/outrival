# SEO & discoverability strategy — Outrival

Written 2026-07-04. Canonical domain decision: **`outrival.app`**.

This doc exists because the site is effectively invisible in search: typing
"outrival", "outrival app", or the product's own name never surfaces it. This is
diagnosed below and turned into a prioritized plan. Owner tags:
`[code]` = shipped in the repo, `[infra]` = Coolify/DNS/Resend config (needs an
explicit prod go), `[manual]` = founder action off the codebase.

---

## 1. The honest diagnosis — 3 root causes, hardest first

### 1.1 "Outrival" is already taken — the wall
Searching `outrival` returns, in order:
- **OutRival, Inc.** (`outrival.com`, `docs.outrival.com`) — a Y Combinator W19
  startup (voice-AI agents, founder Ruben Harris, ~$4.2M ARR). Has a LinkedIn
  company page, Crunchbase, PitchBook, G2, docs. It owns the term.
- The **dictionary word** "outrival" (Merriam-Webster, Cambridge) = to outdo a rival.

We are fighting **a dictionary word AND an established YC startup** on the bare
term. Realistically we will never rank #1 for "outrival" alone. The winnable
targets are qualified queries where the other entity is absent:
- `outrival app`
- `outrival competitive intelligence` / `outrival competitor monitoring`
- `outrival.app`
- brand + feature ("outrival battle cards", "outrival vs Crayon")

**Implication for copy:** always pair the brand with a qualifier in titles/meta
so the disambiguation is baked in ("Outrival — competitive intelligence",
"Outrival.app"). Never ship a bare "Outrival" `<title>`.

### 1.2 The site is not indexed — the actual root cause of "we never show up"
`site:outrival.app` and `site:outrival.io` both return **zero** results on Google.
Google does not know the site exists. This is not a ranking problem, it is an
**indexing** problem — until fixed, nothing else matters. It's also the fastest
fix (days after Search Console submission). Almost certainly the site was never
verified/submitted to Google Search Console (`metadata.verification` is unset).

### 1.3 Domain inconsistency: `outrival.app` vs `outrival.io` — CLOSED 2026-08-02
- The **web app** (canonicals, `metadataBase`, sitemap, robots, OG image text,
  JSON-LD) was already consistently on **`outrival.app`**, the live deploy
  (2026-06-14).
- The **backend/config** used to reference **`outrival.io`** in `WEB_URL`,
  `BETTER_AUTH_URL`, `AUTH_COOKIE_DOMAIN`, the email from-addresses and the
  scraper bot UA. All code fallbacks and every doc/`.env.example` placeholder are
  now `.app`; `outrival.io` was never ours (it resolves to `165.227.254.193`, an
  unrelated host) and is absent from the Resend account, so the old email
  fallbacks could only ever have been refused.

For Google and LLMs, **entity consistency** (one domain everywhere) is a ranking
and knowledge-graph signal. Two contradictory domains dilute it. Decision:
**`outrival.app` is canonical**; every user- and crawler-facing `outrival.io`
reference gets aligned to `.app` (details in §3).

---

## 2. Current state — code audit

### Already good (don't touch)
- Rich root `metadata` in `apps/web/src/app/layout.tsx`: title + `title.template`
  `"%s — Outrival"`, description, `metadataBase = https://outrival.app`,
  `alternates.canonical`, `openGraph`, `twitter: summary_large_image`,
  `robots: { index: true, follow: true, googleBot max-image-preview: large }`.
- Per-page `metadata` with unique title + canonical on every public page
  (`/demo`, `/changelog`, `/status`, `/privacy`, `/terms`, `/dpa`, `/docs`).
- JSON-LD (`apps/web/src/components/landing/json-ld.tsx`): `WebSite` +
  `Organization` + `SoftwareApplication` (with `Offer`s) + `FAQPage`.
- Dynamic OG + Twitter images (`app/opengraph-image.tsx`, `app/twitter-image.tsx`).
- `robots.ts` allows `/`, disallows `/api/`, `/dashboard/`, `/auth`; points at
  sitemap. Private areas correctly `noindex`. `next.config.ts` redirects are 308.

### Gaps (the fix list)
| # | Gap | File | Impact |
|---|-----|------|--------|
| G1 | No Search Console verification + never submitted | `layout.tsx` metadata / GSC | **Not indexed** (root cause 1.2) |
| G2 | Sitemap lists homepage only | `apps/web/src/app/sitemap.ts` | Other public routes never advertised |
| G3 | No favicon / apple-icon / manifest (`public/` empty) | `apps/web/src/app/` | No brand icon in tabs/SERP; "unfinished" signal |
| G4 | `Organization.sameAs: []` empty | `json-ld.tsx` | Google can't link the entity to LinkedIn/Crunchbase/G2 |
| G5 | Domain inconsistency app vs io | multiple (see §3) | Entity dilution |
| G6 | Almost no content (1 landing; no `/blog`, no `/pricing` URL, no comparison pages) | `apps/web/src/app/` | Nothing to rank; nothing for LLMs to cite |
| G7 | `aggregateRating` undefined in `SoftwareApplication` | `json-ld.tsx` | No rich-result stars |
| G8 | `/dev/cron` not disallowed/noindexed | `app/dev/cron/page.tsx` | Dev tool potentially crawlable |

---

## 3. Canonical domain = `outrival.app` — alignment checklist

Keep `outrival.app` (live + already the web SEO domain). Align every
`outrival.io` reference. Note the code-vs-infra split — `.env.example` is only a
template; the **real** prod values live in Coolify, so some of this is
config, not code (and per prod rules needs an explicit go before any prod switch).

| Reference | Location | Action | Owner |
|-----------|----------|--------|-------|
| Bot UA `+https://outrival.io/bot` | `packages/scrapers/**` | ✅ done — `outrival.app/bot` | `[code]` |
| `WEB_URL ?? "https://outrival.io"` fallback | `apps/workers/src/lib/structural-change-notify.ts` | ✅ done 2026-08-02 — the last `.io` fallback in the repo | `[code]` |
| Email from `auth@outrival.io`, `alerts@outrival.io` | `apps/api`, `apps/workers` | ✅ done 2026-08-02 — `outrival.app` confirmed as the only domain in Resend, so the condition was met and the 5 fallbacks moved | `[code]` + `[infra]` |
| `.env.example` placeholders (`WEB_URL`, `NEXT_PUBLIC_API_URL`, `BETTER_AUTH_URL`, `AUTH_COOKIE_DOMAIN`) | `.env.example` | ✅ done 2026-08-02 | `[code]` |
| Live `WEB_URL`, `BETTER_AUTH_URL`, `AUTH_COOKIE_DOMAIN`, Google OAuth redirect, Stripe URLs | Coolify env / Google console / Stripe | Confirm they already use `.app` (site is live, so likely yes); if any still `.io`, switch deliberately | `[infra]` |
| Resend sender domain | Resend dashboard | Verify `outrival.app` for deliverability + brand consistency | `[infra]` |

> If `outrival.io` is not owned/served, it should 301-redirect to `outrival.app`
> (or be dropped). Never leave two live hosts serving the same content.

---

## 4. Action plan (prioritized by leverage)

### P0 — Get indexed (this week, effect in days)
The single highest-leverage block. Nothing else moves the needle until done.

**Code `[code]`:**
- G1: add `metadata.verification.google` (+ `.other['msvalidate.01']` for Bing)
  once tokens exist.
- G2: expand `sitemap.ts` to every public route (`/`, `/demo`, `/changelog`,
  `/status`, `/privacy`, `/terms`, `/dpa`, `/docs`).
- G3: add `app/icon.tsx` (or `favicon.ico`), `app/apple-icon`, `app/manifest.ts`.
- G8: add `/dev/` to robots `disallow` (or env-gate the route).

**Manual `[manual]` — the actual indexing trigger:**
1. **Google Search Console** → add property `outrival.app` → verify (paste the
   token into `metadata.verification.google`, or DNS TXT) → **submit
   `https://outrival.app/sitemap.xml`** → **URL Inspection → Request indexing** on
   `/` and the top pages. This is action #1, full stop.
2. **Bing Webmaster Tools** → same (import from GSC is one click). Bing feeds the
   web index behind ChatGPT/Perplexity → this is also GEO groundwork.
3. Re-check `site:outrival.app` after 2–5 days; expect pages to start appearing.

### P1 — Build the brand entity (weeks — this is what unlocks real ranking)
Off-site, founder-owned. Code alone cannot do this. Google wants ~30
corroborations from consistent, trustworthy sources before it treats the brand as
a known entity (and eventually shows a Knowledge Panel).

`[manual]`:
- Create/claim, with **identical** name/description/logo/URL everywhere:
  **LinkedIn company page**, **Crunchbase**, **X/Twitter**, **Product Hunt**
  (a launch = backlink + traffic + press mentions), **G2** listing.
- Get listed in the "best competitive intelligence tools 2026" listicles — those
  are the pages that rank #1 for the market and that LLMs synthesize from.
  Competitors already there: Crayon, Klue, Kompyte, Contify, Visualping.
- Keep one canonical "brand facts" sheet (name, one-liner, long description, logo
  URL, founding year, HQ, socials) and reuse it verbatim on every profile —
  consistency is the strongest knowledge-graph lever.

`[code]` once the profiles exist:
- G4: fill `Organization.sameAs` in `json-ld.tsx` with every profile URL.
- G7: add `aggregateRating` once there are real G2/Capterra reviews (never fake it).

### P2 — Content + GEO (the long game)
In 2026 ~25% of searches run through AI assistants (ChatGPT ~70% share); LLMs
cite **structured, sourced content**, not a one-page landing.
`[code]` + content:
- **Comparison pages**: `/vs/crayon`, `/vs/klue`, `/vs/kompyte` — the #1 format
  Google and LLMs serve for SaaS buying queries.
- **`/blog`** with fact- and stat-dense posts (named sources, concrete numbers —
  exactly what LLMs quote).
- Dedicated indexable **`/pricing`** URL (today pricing is only a landing section).
- **`llms.txt`** at the root (emerging 2026 convention guiding AI crawlers).
- Solid internal linking from the landing to all of the above.

### P3 — Polish
- Per-page OG images (all pages share one generic card today).
- Keep JSON-LD validated via Google Rich Results Test after each change.

---

## 5. GEO / AI-search notes (2026)
- AI assistants are becoming the first place a buyer hears a product name; only a
  handful of brands get named in any answer. LLM-referred visitors convert far
  above organic (ChatGPT ~15.9%, Perplexity ~10.5% vs ~1.8% organic).
- What actually works is unglamorous and overlaps with good SEO: solid technical
  foundation, cite authoritative sources, quote named experts, add specific
  statistics, write confident declarative prose, and — critically — **be present
  in the third-party sources the models read** (listicles, G2, Reddit, comparison
  posts). Being un-indexed (§1.2) also means being un-citable by LLMs.
- Submitting to Bing (P0.2) matters here: several AI engines lean on Bing's index.

---

## 6. Realistic expectations
- **Indexing** (P0): visible in `site:outrival.app` within days of GSC submission.
- **Ranking** on "outrival app" / market queries: weeks→months, gated by P1+P2
  (authority + corroborations). No shortcut.
- **"outrival" bare term / Knowledge Panel**: hardest, contested by the YC
  company + dictionary word; treat as a long-term entity-building outcome, not a
  near goal.

**KPIs to watch in GSC:** pages indexed, impressions/clicks on branded queries
("outrival app", "outrival competitive intelligence"), average position on
market terms, and appearance in AI Overviews.

---

## 7. Sources
- [Technical SEO Checklist 2026 — DebugBear](https://www.debugbear.com/blog/technical-seo-checklist)
- [Full Technical SEO Checklist 2026 — Yotpo](https://www.yotpo.com/blog/full-technical-seo-checklist/)
- [GEO: The 2026 Guide to AI Search Visibility — LLMrefs](https://llmrefs.com/generative-engine-optimization)
- [GEO vs AEO vs SEO 2026 — Jasper](https://www.jasper.ai/blog/geo-aeo)
- [Get your brand in Google's Knowledge Graph — Search Engine Journal](https://www.searchenginejournal.com/get-brand-in-google-knowledge-graph-without-wikipedia-page/356530/)
- [Google Knowledge Panel — Semrush](https://www.semrush.com/blog/google-knowledge-panel/)
- Brand-collision evidence: [OutRival Inc. (YC W19)](https://www.ycombinator.com/companies/outrival-inc), [outrival.com](https://www.outrival.com/), [Merriam-Webster "outrival"](https://www.merriam-webster.com/dictionary/outrival)
