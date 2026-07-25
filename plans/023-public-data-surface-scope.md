# Plan 023: Decide whether the data the pipeline already collects can become a public acquisition surface, and scope one pilot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. This plan is a **scoping and legal-gate spike**. It
> writes **no application code and publishes no page**. Its deliverable is an
> inventory, a legal question set for the operator, and a specification for one
> narrow pilot that a future plan may build **only if the operator clears the
> gate**. When done, update the status row for this plan in `plans/README.md`,
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/web/src/app/sitemap.ts apps/web/content/blog docs/seo-strategy.md .claude/rules/scraping.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED-HIGH if built without the gate; LOW as executed here (no code)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

The pipeline produces a large amount of structured, dated, hard-to-obtain data about
B2B SaaS companies: current and historical pricing with free-trial facts, open-role
counts by department and week, review scores with sub-scores, detected third-party
tech stacks, platform profiles. All of it is private to the organization that
triggered the scrape.

Meanwhile the product's entire indexable surface is 27 static routes, of which 15
are legal and policy pages, plus 3 blog posts. The acquisition surface is 7 pages:
`/sample`, three `/vs/*` and three `/alternatives/*`
(`apps/web/src/app/sitemap.ts:14-26`).

The search problem is worse than a small surface. `docs/seo-strategy.md:15-24`
records that the brand term is contested by an established YC company on
`outrival.com` plus a dictionary word, and concludes the bare term is "a long-term
entity-building outcome, not a near goal". Branded search is not a route in. That
leaves non-branded queries, and the only durable non-branded asset this product has
that competitors cannot copy is the data its own scrapers already collect.

There is a serious catch, which is exactly why this is a gate and not a build.
`.claude/rules/scraping.md` establishes a **collection** doctrine: collect what is
open, stop on refusal, honour robots.txt, identify the bot. It says nothing about
**republication**, which is a different legal question with different inputs
(database rights, source-site terms, and named individuals in job postings and
reviews). `docs/legal-compliance.md:8` already flags that "Outrival scrapes
third-party sites", and the product publishes a subprocessors page and a DPA. This
is not a codebase where "publish it and see" is an acceptable move.

So: inventory precisely what could be published, put the legal question in front of
the operator in a form they can answer, and pre-specify one narrow pilot so that a
"yes" converts into work immediately and a "no" costs nothing.

## Current state

### The indexable surface today

`apps/web/src/app/sitemap.ts:6-13` opens with:

```ts
// Public, indexable routes only. Private areas (/dashboard, /auth, /admin,
// /onboarding, /api, /dev) are excluded here and disallowed in robots.ts.
```

and lists, among 27 entries, the entire acquisition set:

```ts
  { path: "/sample", changeFrequency: "monthly", priority: 0.9 },
  { path: "/vs/crayon", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/klue", changeFrequency: "monthly", priority: 0.8 },
  { path: "/vs/diy", changeFrequency: "monthly", priority: 0.8 },
  { path: "/alternatives/crayon", changeFrequency: "monthly", priority: 0.7 },
  { path: "/alternatives/klue", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/alternatives/best-competitive-intelligence-tools",
    changeFrequency: "monthly",
    priority: 0.8,
  },
```

Blog posts are appended from `getAllPosts()`. There are exactly three, in
`apps/web/content/blog/`:
`how-outrival-scraping-pipeline-works.mdx`,
`competitor-changed-pricing-founder-playbook.mdx`,
`what-crayon-actually-costs-in-2026.mdx`.

### How a public page is authored today

`apps/web/src/lib/blog.ts:5-9`:

```ts
// Local-file MDX blog. Posts live as `.mdx` files in `apps/web/content/blog`
// (process.cwd() is the app root at build time). Frontmatter is parsed here for
// the listing / metadata / RSS; the raw body is compiled per-post by the article
// page (see components/blog/mdx.tsx). No CMS, no bundler magic — just fs reads at
// build, so every post prerenders to static HTML with zero client JS.
```

This matters for the pilot spec: pages are **prerendered at build from local files
today**. A data-backed page reads the database instead, which is a different
rendering and revalidation story, and the pilot must say which.

### The one public data route that exists, and why it is not a precedent

`apps/web/src/app/report/[token]/page.tsx:16,23`:

```ts
// cookies. Always noindex + never in the sitemap: the token is the only capability.
  robots: { index: false, follow: false },
```

Share links are a **capability**, deliberately unindexed. They are not an example of
publishing data; they are an example of not publishing it. Do not cite them as
precedent in the decision doc.

### What the SEO plan already covers, and what it does not

`docs/seo-strategy.md:149-159` (P2) already commits to comparison pages, a
fact-dense blog, an indexable `/pricing`, `llms.txt` and internal linking. It does
**not** contemplate publishing collected competitor data. This plan is additive to
that list, not a replacement for it. Say so explicitly in the decision doc so the
two are not read as competing plans.

### The data that exists

From `packages/db/src/schema/analytics.ts` and the relational schema. All of it is
keyed by `competitor_id`, which is an **org-scoped row**: the same company tracked
by two organizations is two `competitors` rows. Any public page therefore needs an
entity-resolution step (domain, most likely) that does not exist today. Name that
in the inventory; it is the single biggest hidden cost.

- `pricing_history` (line 26): plan name, price, currency, billing period, trial
  facts, `recorded_at`.
- `hiring_metrics` (line 85) and `job_counts` (line 67): open roles per canonical
  department per ISO week.
- `review_scores` (line 109): score, review count, sub-scores per source.
- `tech_stack_entries` and `tech_stack_history` (line 328): detected third-party
  technologies with appear/disappear events.
- `competitors.platform_profile`: framework, CMS, ATS, status page, changelog.

### Conventions and constraints that apply

- **Collection doctrine** (`.claude/rules/scraping.md`): "on collecte ce qui est
  ouvert, on ne force JAMAIS une porte fermée". robots.txt honoured before any
  request, identifiable `OutrivalBot` UA, per-domain rate limit, refusal means stop.
  This governs how the data was obtained. It does not authorize republishing it.
- **Third-party review verbatims are never scraped** (`docs/architecture.md`,
  Reviews v2, 2026-07-15): the scraped aggregators were retired for legal reasons
  and only an official-API surface (score plus trend) remains. Whatever the decision,
  review **verbatims** are out; that one is already settled and must not be reopened.
- **`PRODUCT.md:43-53` anti-references** apply to any page produced later: no
  generic SaaS template, no gradient text, no all-caps tracked eyebrow, no emoji as
  UI. A programmatic page is still a brand surface.
- **English only** (`.claude/rules/language.md`).
- No em-dashes in prose you write; rephrase instead of substituting a hyphen.

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0, 8 tasks     |
| Tests     | `pnpm test`      | exit 0, all pass    |

Both are run only as a regression guard: this plan changes no code, so both must be
green and the diff must contain no `.ts`/`.tsx` file at all.

**Environment gotcha**: `turbo` is not on `PATH`; a bare `turbo typecheck` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.

## Scope

**In scope**:
- `docs/public-data-surface.md` (create) — the inventory, the gate, the pilot spec
- `docs/seo-strategy.md` (append one cross-reference line only)

**Out of scope** (do NOT touch, without exception):
- Every file under `apps/`, `packages/`, and `.claude/`. This plan ships no code.
- `apps/web/src/app/sitemap.ts` and `robots.ts`. Adding a route to the sitemap is
  publishing; it is what the gate exists to authorize.
- `apps/web/content/blog/`. Writing a post is content work, not this plan.
- `.claude/rules/scraping.md`. The collection doctrine is a standing decision. If
  the legal answer requires changing it, that is the operator's call in its own
  change, and it should be loud, not folded into a scoping doc.
- Any change to what is scraped, how often, or from where. Publishing must not
  become a reason to collect more.

## Git workflow

- Branch: `advisor/023-public-data-surface`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `feat(sources): ...`. Suggested: `docs: scope a public data surface`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Inventory what could be published

In `docs/public-data-surface.md`, build one table with a row per candidate dataset
(the six listed in "Current state"). Columns:

| dataset | table + file:line | subject | is it a fact about a company, or about a person? | already-public elsewhere? | entity-resolution needed |

Fill it by reading the schema files; do not query production. Two rows need care and
must be marked plainly:

- **Job postings** carry role titles and sometimes named hiring contacts. Anything
  naming an individual is personal data under GDPR and is a different legal question
  from a price. Mark it.
- **Review scores** are aggregates from sources whose terms were already found
  restrictive enough to retire the scrapers (`docs/architecture.md`, Reviews v2).
  Mark it as presumptively excluded.

Then add a short section, "The entity problem", stating that `competitors` rows are
org-scoped, so N organizations tracking the same company produce N rows with N
independent scrape histories, and a public page needs a canonical entity keyed on
something stable (registrable domain is the obvious candidate). Give a rough size
for that work in the same S/M/L vocabulary this plan uses. Do not design the
resolution scheme.

**Verify**: `test -f docs/public-data-surface.md`, and the table has one row per
dataset with no cell left empty.

### Step 2: Write the legal gate as questions, not as an opinion

Add a section, "Gate: questions for the operator". You are not a lawyer and neither
is the executor of the follow-up plan. Write the questions so the operator can take
them to counsel or answer them from an existing position. At minimum:

1. Does republishing **facts** collected under the collection doctrine (a price on a
   public pricing page, on a date) create exposure the doctrine does not already
   cover, given that the doctrine addresses collection only?
2. Does a systematic, dated compilation of those facts engage the EU **sui generis
   database right** of the source sites, separately from copyright in the pages?
3. Do the source sites' terms of use restrict republication even where robots.txt
   permits crawling, and does that differ per source category (marketing pages,
   ATS boards, status pages)?
4. Does any candidate dataset contain **personal data** (named individuals in job
   postings), and if so is it excluded outright rather than minimized?
5. Does naming a company on a page that also sells competitive monitoring of that
   company create a distinct commercial or reputational exposure, independent of the
   data question?
6. Is there a takedown and correction path the product must offer before publishing,
   and who operates it?

State explicitly, in bold, that **no page ships until questions 1 to 4 are answered**,
and that the answer is the operator's to give, not the executor's to infer.

**Verify**: `grep -c "^[0-9]\." docs/public-data-surface.md` returns at least 6.

### Step 3: Specify exactly one pilot, conditional on a yes

Add a section, "Pilot, if the gate clears". One page type, not a program. Specify:

- **The page**: one URL shape, one dataset, one entity per page. Recommend the
  narrowest useful option and say why. As guidance, the pricing dataset is the
  strongest candidate because a published price is the least ambiguous kind of
  public fact and the data is already dated and versioned, while hiring and tech
  stack are more inferential and reviews are presumptively excluded.
- **Rendering**: static generation at build from a fixed entity list, or on-demand
  with revalidation. Pick one and give the reason. Note that today's public pages
  prerender from local files at build (`apps/web/src/lib/blog.ts:5-9`), so a
  database-backed page is a new pattern for this app and needs a cache story.
- **The entity list**: how the first N companies are chosen, and how the list is
  bounded. It must be explicit and small, and it must not be "every competitor any
  org tracks", which would publish the customer base's interests.
- **What is never on the page**: the customer who triggered the scrape, any
  organization identifier, review verbatims, anything naming an individual, and any
  AI-generated characterization of the company. Facts and dates only.
- **Provenance and correction**: each fact shows its observation date and the public
  URL it came from, and the page carries a visible correction contact. This is both
  a trust property and the honest answer to gate question 6.
- **Robots and canonical**: the pilot pages are indexable, which is the entire
  point, and must be added to `sitemap.ts`. Say that explicitly so the follow-up
  plan does not have to infer it.
- **The kill switch**: one env variable that removes the routes and the sitemap
  entries in one change, following the repo's existing pattern
  (`VISUAL_DIFF_ENABLED` at `apps/api/src/routes/signals.ts:601,634` is the model:
  a false value 404s the endpoint and hides the surface).
- **Success criterion and review date**: what number, measured where, decides
  whether page 2 gets built. Impressions in Search Console is the honest metric, and
  the horizon is months, per `docs/seo-strategy.md:180-186`.

**Verify**: the section names exactly one URL shape and one dataset.

### Step 4: Write the fallback for a no

Add a section, "If the gate does not clear". It must contain at least two options
that need no legal review, each in three lines:

- Extending the format already sanctioned and shipped: more `/vs/*` and
  `/alternatives/*` pages. `docs/seo-strategy.md:153` already commits to
  `/vs/kompyte`, which does not exist yet, so there is uncontroversial work ready.
- Publishing the product's **own** aggregate observations without naming any third
  party, for example "across the SaaS pricing pages we watch, X% changed price this
  quarter". The subject there is Outrival's own measurement, not a company.

This section is what keeps a "no" from ending the whole direction.

**Verify**: `grep -n "If the gate does not clear" docs/public-data-surface.md`
returns one match.

### Step 5: Cross-reference the SEO plan

Append one line under `docs/seo-strategy.md` P2 (around line 159) pointing at
`docs/public-data-surface.md` and stating it is an additional, gated candidate, not
a replacement for the P2 list.

**Verify**: `grep -n "public-data-surface" docs/seo-strategy.md` returns one match.

## Test plan

No tests: this plan writes documentation only. The verification is that the code
tree is untouched and both gates stay green.

## Done criteria

ALL must hold:

- [ ] `docs/public-data-surface.md` exists with all four sections: inventory (with
      "The entity problem"), gate questions, pilot spec, fallback
- [ ] The gate section contains at least 6 numbered questions and a bold statement
      that no page ships before questions 1 to 4 are answered
- [ ] The pilot section names exactly one URL shape and one dataset
- [ ] `docs/seo-strategy.md` cross-references the new doc
- [ ] `git diff --name-only` lists **only** files ending in `.md`
- [ ] `pnpm typecheck` exits 0 and `pnpm test` exits 0 (unchanged from baseline)
- [ ] `plans/README.md` status row for 023 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You are about to create or modify any file outside `docs/`. This plan ships no
  code, no route, no sitemap entry. There is no small exception.
- You conclude the legal questions can be answered from the repository. They cannot.
  `.claude/rules/scraping.md` covers collection; `docs/legal-compliance.md` covers
  the product's own privacy obligations. Neither addresses republication of
  third-party facts. If you find a document that does, quote it and report rather
  than assuming.
- The inventory shows a candidate dataset that is already published somewhere by
  this product. That would contradict the premise and needs reporting, not working
  around.
- `apps/web/src/app/sitemap.ts` no longer matches the excerpt, meaning the public
  surface changed since this plan was written.

## Maintenance notes

- The gate is the durable artifact. Even if the answer is no, the questions and the
  reasoning stop this idea from being re-proposed from scratch every quarter, which
  is the main cost of an unwritten decision.
- If a pilot is ever built, the two things a reviewer must check are that no page
  can reveal **which organization** tracks a company (that leaks the customer base's
  interests, which is a worse disclosure than any price), and that the kill switch
  removes the sitemap entries as well as the routes. A page pulled from the app but
  left in the sitemap keeps being crawled.
- Deliberately deferred: the entity-resolution scheme, `llms.txt`, and per-page OG
  images. The first is real work that only matters after a yes; the other two are
  already owned by `docs/seo-strategy.md` P2 and P3.
- The three installed community skills that would apply to a build phase are
  `programmatic-seo`, `competitor-alternatives` and `schema-markup`. Per
  `CLAUDE.md` they are invoked explicitly only, never allowed to self-trigger. Do
  not invoke them in this plan; there is nothing to generate yet.
