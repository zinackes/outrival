# SEO & discoverability strategy for Outrival

Canonical domain: **`outrival.app`**.
First written 2026-07-04 (pre-launch foundation). **Rewritten 2026-08-01** against
real Search Console data, which changed the diagnosis: the site is now crawled and
partly indexed, so the problem has moved from "invisible" to "indexed but
uncited". Owner tags: `[code]` = in the repo, `[infra]` = Coolify/DNS/Cloudflare,
`[manual]` = founder action off the codebase.

---

## 0. Where we actually are (measured 2026-08-01)

| Signal | Value | Reading |
|---|---|---|
| Pages in the index | **2** | of 23 known. The single biggest number on this page. |
| Pages not indexed | **21**, 4 reasons | Google has seen them and declined. |
| Sitemap | submitted, read 2026-07-30, 29 URLs discovered | Discovery works. Not the bottleneck. |
| Impressions, 3 months | 173 | about 2 a day. |
| Clicks, 3 months | **0** | CTR 0% at average position 8.6. |
| Queries | **brand only** ("outrival", variants) | No non-brand query has ever produced an impression. |

Three facts follow from that table, and every priority below comes from them.

1. **Crawling is not the problem.** 29 URLs discovered, sitemap accepted, every
   public page returns 200 with `index, follow`. Nothing is blocked.
2. **Indexing is the problem.** 21 of 23 declined is Google saying "seen it, not
   worth storing". That is a quality and authority verdict on a domain with no
   corroborating links, not a technical fault.
3. **Zero non-brand impressions is a content-surface problem.** Nine commercial
   pages, in a market where the incumbents publish hundreds. There is almost
   nothing for a non-brand query to match.

### On the Lighthouse warning
"Search engines are unable to include your pages in search results if they don't
have permission to crawl them" is Lighthouse's `is-crawlable` audit. It fires when
the audited URL carries `noindex`, an `X-Robots-Tag`, **or is disallowed in
robots.txt**. Verified 2026-08-01 across all 29 sitemap URLs:

- every one returns HTTP 200 with `<meta name="robots" content="index, follow">`
  and a self-referencing canonical;
- no `X-Robots-Tag` header on any response;
- `robots.txt` is byte-identical for Googlebot, Chrome-Lighthouse, GPTBot and
  PerplexityBot, so Cloudflare is not injecting AI-crawler blocks (see §4).

No public page is blocked. The audit fires on `/dashboard`, `/auth`, `/report/*`
or `/brief/*`, which are disallowed **on purpose**: a logged-in app screen must
not be in the index. Run Lighthouse against `https://outrival.app/` or `/pricing`
and the audit passes. **There is nothing to fix here.** The only real action it
produced was tightening `/dashboard/` to `/dashboard` so the bare entry point is
covered too.

---

## 1. The three root causes, hardest first

### 1.1 Brand collision, the wall (unchanged)
`outrival` is a dictionary word ("to outdo a rival", Merriam-Webster) **and** an
established YC W19 company, **OutRival, Inc.** (`outrival.com`, voice AI). They
own the term: LinkedIn, Crunchbase, PitchBook, G2, docs subdomain.

That is why average position is 8.6 on our own brand name and CTR is 0. We sit on
page one for "outrival" and nobody clicks the eighth result when the first is the
company they meant. **Never ship a bare "Outrival" title.** Winnable queries:
`outrival app`, `outrival competitive intelligence`, `outrival.app`,
`outrival vs crayon`.

The machine-readable half of this fight is `Organization.sameAs`, still empty
(§3, G4). Until it points at profiles that corroborate us, a search engine has no
evidence that this domain is a distinct entity from `outrival.com`.

### 1.2 No authority, which is why 21 pages are declined
A domain with effectively zero inbound links has no crawl-priority budget and no
quality prior. Google's guidance and every practitioner write-up converge on the
same fix list for "Discovered / Crawled, currently not indexed": internal links,
crawl depth, sitemap quality, canonical setup, content differentiation.
Repeatedly hitting "Request indexing" does nothing. This is fixed off-site (§5).

### 1.3 Nothing to match a non-brand query
Nine commercial URLs and three articles. "Competitive intelligence software" is
contested by vendors with a decade of content behind them. The realistic entry
points are long-tail, high-intent and specific, and the one with the highest
intent in this category, *what it costs*, had no page at all until 2026-08-01
(§2).

---

## 2. Shipped 2026-08-01 `[code]`

| # | Change | Why |
|---|---|---|
| S1 | **`/pricing` as a real URL** (`app/pricing/page.tsx`) with a sourced "what this category costs" table, a 7-question FAQ plus `FAQPage` JSON-LD, and breadcrumbs | Pricing existed only as `/#pricing`. The highest-intent query in the category had no page to rank and no document to cite. Every rival hides its price behind a demo, so this is also the one question the web answers badly. |
| S2 | **8 internal links repointed** from `/#pricing` to `/pricing` across the footer, the compare shell and all four comparison templates | A new page with no internal links does not get indexed. |
| S3 | **Sitemap: honest `lastmod`** | Every URL was stamped `new Date()` at build time. Google's stated behaviour is that lastmod trust is **binary per site**: one look at 29 URLs all modified today and the signal is discarded site-wide. Dates are now per-route literals, and omitted where unknown. |
| S4 | **Sitemap: legal boilerplate removed** (7 URLs) | 11 of the 29 submitted URLs were legal text. A sitemap tells Google which pages we consider our best; it now lists 22, mostly commercial. Those pages stay indexable and stay linked in the footer. |
| S5 | **`changefreq` and `priority` dropped** | Google has ignored both for years. They asserted a ranking order for our own pages that nothing reads. |
| S6 | **`/llms.txt`** (`app/llms.txt/route.ts`) | The llmstxt.org convention: one plain-text file stating what the product is, what it costs, and which pages are worth reading. Generated from the same constants the pricing and comparison pages render, so it cannot drift. See §4. |
| S7 | **IndexNow**, key at `public/9d965d…966.txt`, run with `pnpm --filter @outrival/web indexnow` | Bing's index is the retrieval layer behind ChatGPT Search and Copilot. Waiting for an organic Bing crawl on a zero-authority domain takes weeks; one POST replaces it. Google does not support IndexNow, so this is an AI-visibility play, not a Google one. |
| S8 | **Entity markup**: `Organization.description` and `knowsAbout` added, `SoftwareApplication` given `@id`, `url` and `publisher` so it links to the org, empty `sameAs` omitted rather than emitted | §1.1. The product entity floated free of the company entity, and nothing said they were the same thing. |
| S9 | **robots.txt**: `/dashboard/` tightened to `/dashboard`, `/brief/` added | The bare app entry point was crawlable, and `/brief/*` are one-off generated documents worth nobody's crawl budget. |
| S10 | **Internal links added to 2 of the 3 blog posts** | Two posts linked nowhere. Articles that link to money pages are how link equity reaches them. |

Verification after deploy: `bun scripts/check-metadata.ts`, which now covers
`/pricing`.

---

## 3. Remaining code gaps

| # | Gap | File | Blocked on |
|---|-----|------|-----------|
| G4 | `Organization.sameAs` empty | `components/landing/json-ld.tsx` (`SAME_AS`) | The profiles existing (§5). One line per URL once they do. |
| G7 | No `aggregateRating` | same | Real reviews. **Never fake it**: it is a structured-data policy violation and a manual action. |
| G11 | No per-page OG images | `app/*/opengraph-image.tsx` | Nothing. Low priority, it affects share CTR rather than ranking. |
| G12 | No Bing / Yandex verification meta | `layout.tsx` `metadata.verification` | Tokens from Bing Webmaster Tools (§5). |

---

## 4. AI search (AEO / GEO), what is actually true in 2026

Gartner's January 2026 figure is that around 40% of information-seeking queries
now start in an AI interface. For a product nobody searches by name, that channel
is more reachable than blue links, because an assistant will name a product it can
*state facts about* even when the domain has no authority.

What that requires, in order of leverage:

1. **Be crawlable by the AI bots.** Verified clean (§0). The trap is Cloudflare's
   **"Managed robots.txt"** toggle (AI Crawl Control): it injects
   `GPTBot / ClaudeBot / Google-Extended / CCBot: Disallow: /` **above** the app's
   own robots.txt and cannot be overridden from code. It was ON once already,
   found and turned off on 2026-07-04. **If AI crawlers vanish from the logs,
   check that toggle before anything else.** `[infra]`
2. **Be in Bing.** ChatGPT Search and Copilot retrieve from it, hence S7. The code
   half is done; the Bing Webmaster account is `[manual]` (§5).
3. **State facts in a form a model can lift**: dated, attributed, specific. The
   comparison pages already do this well, with named third-party sources and a
   review date, and `/pricing` plus `/llms.txt` now do too. Vague marketing prose
   is uncitable, because a model will not assert something it cannot ground.
4. **Structured data.** `FAQPage`, `Organization`, `SoftwareApplication` and
   `BreadcrumbList` are the types answer engines resolve entities with. All four
   ship. Only `sameAs` is missing.
5. **Be present in the third-party sources the models read**: listicles, review
   platforms, Reddit, comparison posts. That is §5, and it is not code.

Honest caveat: `llms.txt` is a convention, not a standard, and no major engine has
committed to reading it. It costs one route handler and is generated from live
constants, so the downside is nil, but nothing on this page depends on it.

---

## 5. The actual ranking levers, `[manual]`, founder only

Code cannot move §1.2. This list can, roughly in order of impact.

1. **Fix the brand-collision signal.** Create, with *identical* name, one-liner,
   logo and URL everywhere: LinkedIn company page, then Crunchbase, X, Product
   Hunt, and a review-platform listing. Then paste each URL into `SAME_AS` (G4).
   This is the highest-leverage manual action on this page. It is what turns
   `outrival.app` from an orphan domain into an entity, and it unblocks the 21
   declined pages more than any on-page edit will.
2. **Bing Webmaster Tools**, one-click import from Search Console. Feeds §4.2 and
   yields the token for G12.
3. **Get into the listicles.** "Best competitive intelligence tools 2026" pages
   are what ranks for the market *and* what LLMs synthesise from. Crayon, Klue,
   Kompyte, Contify and Visualping are already in them. Getting added is outreach,
   not code.
4. **Product Hunt launch**, a one-shot: backlink, traffic, press mentions, plus
   the corroboration in (1). Do it once the product is ready, not before.
5. **Write where the buyers already are.** One substantive answer in a thread
   about competitor tracking outperforms three more pages on this domain right
   now, because it carries a link from a domain Google already trusts.

---

## 6. Content plan, and why *not* to mass-produce pages yet

The instinct with 0 non-brand impressions is to publish 30 pages. With 21 of 23
already declined, that makes things worse: thin pages on a low-authority domain
are the exact input that produces "Crawled, currently not indexed", and the ratio
of declined to indexed is itself a site-level signal.

The order that works is **deepen, then widen.**

**Now, deepen what exists.** Each of these is a page Google already knows about:

- `/pricing`: keep the category cost table current. It is the most linkable asset
  on the site, because it publishes a number the whole category hides.
- The three `/vs/*` and three `/alternatives/*` pages: refresh `LAST_REVIEWED` and
  re-read the Vendr figures. A dated, re-checked comparison is what both buyers
  and models prefer over an undated one.
- Blog: three posts is not a blog. Two a month, fact-dense, named sources, real
  production numbers. The pipeline post is the model to copy, since it quotes
  measured ratios. Outrival's unfair advantage is that it *measures* this market.

**Next, widen one page at a time, and only when the previous one gets indexed:**

- `/vs/kompyte`, `/vs/visualping`, `/vs/contify`, same template, real research for
  each. Do not ship three at once.
- Informational pages for the queries a buyer types before they know the category
  exists: "how to track competitor pricing changes", "competitor monitoring for
  startups". Those are what feed AI answers.

**Rule of thumb:** if a new page cannot say something the first page of results
does not already say, it will not be indexed, and shipping it costs more than
skipping it.

---

## 7. Realistic expectations

- Indexing of the newly-linked pages: days to weeks after deploy. The 21 declined
  pages move on §5, not on §2.
- Non-brand impressions: the first ones from long-tail comparison and pricing
  queries within weeks, meaningful volume at 4 to 8 months. Practitioner consensus
  for B2B SaaS is ranking movement at 3 to 4 months, traffic at 6 to 8, pipeline
  at around 12.
- "outrival" as a bare term, or a Knowledge Panel: a long-term entity outcome,
  contested by a YC company and a dictionary word. Not a goal.

**KPIs, in this order:** pages indexed (2, target 20+), then the first non-brand
impression, then non-brand clicks, then appearing in AI Overviews and ChatGPT
answers for "competitive intelligence tool for founders".

---

## 8. Sources
- [Page is blocked from indexing, Lighthouse, Chrome for Developers](https://developer.chrome.com/docs/lighthouse/seo/is-crawlable)
- [How to fix "Discovered, currently not indexed", Onely](https://www.onely.com/blog/how-to-fix-discovered-currently-not-indexed-in-google-search-console/)
- [Sitemap lastmod: Google says drop inaccurate dates](https://www.digitalapplied.com/blog/xml-sitemap-lastmod-hygiene-illyes-directive-seo-2026)
- [Why IndexNow matters for GEO: without Bing, your brand stays invisible to ChatGPT](https://www.oltre.ai/blog/indexnow-for-geo-bing-chatgpt-visibility/)
- [Does Google support IndexNow in 2026? No, here's who does](https://pressonify.ai/blog/indexnow-instant-indexing-press-releases-2026)
- [Answer Engine Optimization (AEO): get cited by AI in 2026](https://www.graygroupintl.com/blog/answer-engine-optimization-aeo-guide-2026/)
- [Structured data for AI search: schema markup guide 2026](https://www.stackmatix.com/blog/structured-data-ai-search)
- [Programmatic SEO for SaaS: how to do it the right way in 2026, TripleDart](https://www.tripledart.com/blog/programmatic-seo-for-saas)
- [llmstxt.org, the llms.txt convention](https://llmstxt.org/)
- Brand collision: [OutRival Inc. (YC W19)](https://www.ycombinator.com/companies/outrival-inc), [Merriam-Webster "outrival"](https://www.merriam-webster.com/dictionary/outrival)
