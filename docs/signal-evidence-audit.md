# Signal evidence audit (2026-07-29)

Why so many signals read as "something happened, trust us" instead of naming the
facts. Covers every source, not just hiring. Read-only audit: no code changed.

Trigger case: a `jobs` signal on Later says "adding roles in UX design,
engineering, revenue operations, partnerships, and influencer marketing" and
names not one role. At that exact moment `job_postings` held every title, its
location, its seniority and its apply URL, written by the same scrape.

## 1. The diagnosis in one line

A signal has exactly **two** evidence pipes, and both were built for a
single-value change on a homepage. Every other shape of change (a set of N new
items, which is most sources) falls through them and reaches the reader as prose
only.

## 1b. Measured on prod (2026-07-29, 344 signals)

| source | signals | no before/after pair | no structured breakdown |
|---|---|---|---|
| homepage | 97 | 46 | 52 |
| pricing | 97 | 55 | 97 |
| jobs | 58 | 38 | 58 |
| tech_stack | 39 | 0 | 39 |
| blog | 26 | 18 | 26 |
| changelog | 9 | 9 | 9 |
| news | 9 | 5 | 9 |
| ai_visibility | 6 | 0 | 6 |
| sitemap | 2 | 2 | 2 |
| review_shift | 1 | 0 | 1 |
| **total** | **344** | **173 (50%)** | **299 (87%)** |

Only homepage ever carries a breakdown (45 of its 97), so for every other source
"no pair" means no evidence at all: **127 signals, 37% of the feed, render prose
and nothing else.** Part of homepage's 46 pairless signals land there too, since
52 of them have no breakdown either.

Three things the numbers say that reading the code did not:

- **Pricing is the worst bucket in absolute terms, not the best.** 55 of 97
  without a pair. A pricing page in practice moves several plans at once, so it
  is a set like the others, and the eight-word single-pair rule returns null. It
  is the product's highest-volume source and `pricing_history` is written by the
  same scrape.
- **Structured homepage covers only 45 signals of 97.** The lexical fallback is
  not an edge case, it is 54% of homepage signals, and it carries neither pipe.
- **The deterministic paths never miss**: tech_stack 0 of 39, ai_visibility 0 of
  6, review_shift 0 of 1. Meanwhile changelog is 9 of 9 pairless, sitemap 2 of 2,
  blog 18 of 26. The facts are not missing from the product. They are lost when
  the change goes through the AI classifier instead of a synthesized
  classification.

## 2. The two pipes

**Pipe A: `signals.human_change_before` / `_after`.** One pair of strings,
produced by the classifier. The prompt (`packages/ai/src/tasks/classify.ts:183`)
asks for "the SINGLE most important change", caps each side at about eight
words, forbids concatenating several, and ends with:

> If you can't extract a clean before/after, return null for BOTH fields.

A change that is "12 roles appeared" has no clean pair, so the honest answer is
null, and the UI section is gated on it
(`signal-detail-panel.tsx:557`). That is exactly the screenshot: no "What
changed" block at all.

**Pipe B: `changes.structured_diff`.** Written by one differ only, the structured
homepage differ (`scrape-monitor.ts:1421`). It is what feeds `ChangeBreakdown`
and `GroupedChanges`, the good per-change UI. Every other source stores `null`
there, so the "Evidence" section is also gated out (`signal-detail-panel.tsx:616`).

Net effect: **structured homepage signals are rich; everything else gets three
prose blobs** (insight, so_what, recommended_action) plus, sometimes, an
eight-word pair.

## 3. Already stored, never shown

This is the important part. Almost nothing here needs new scraping or new AI.

| Data | Written by | Read by the signal? |
|---|---|---|
| `changes.diff_text` (up to 50 KB) | every change path | **No.** `/signals/:id/detail` deliberately omits it (`signals.ts:534`) |
| `changes.raw_diff.{added,removed}` | every lexical change (`scrape-monitor.ts:1706`) | **No** |
| `changes.raw_diff` HN extras: points, numComments, threadUrl | HN branch (`scrape-monitor.ts:1464`) | **No**, only the competitor product tab reads them (`competitors.ts:1299`) |
| `signals.materiality` {decisionImpact, urgency, corroboration} | generate-signal (`generate-signal.ts:420`) | **No** |
| `job_postings` rows: title, department, location, url, seniority, salary | extract-jobs (`extract-jobs.ts:197`) | **No.** They feed `monitors.ai_summary` and the Hiring tab only |
| `pricing_history` rows: plan, price, period, trial facts | extract-pricing | **No** |
| `review_scores`: score, review count, 4 sub-scores, complaint themes | extract-reviews | **No** |
| `tech_stack_entries`: tech, category, importance, evidence | scrape-tech-stack | **No** |
| `numeric_claims`: pattern, value, raw_text | homepage enrichments | **No** |
| `hiring_metrics`: open roles per bucket per week | extract-jobs | **No** (only the Hiring tab sparklines) |

Two of these are worth calling out because the code says out loud that it stored
them for the reader:

- The HN branch comments its extras as "structured here so a reader can be shown
  '312 points' without the UI having to parse them back out of a sentence".
  Nothing on the signal reads them.
- `SeverityScale` documents itself as "the band is now a deterministic function
  of the materiality sub-scores, so showing the scale is showing the reasoning"
  (`severity-scale.tsx:24`). The sub-scores are never sent to the client, so the
  scale shows the conclusion and hides the reasoning. In the screenshot that
  produces a visible contradiction the reader cannot resolve: severity "Medium"
  next to "Low threat", with no way to see why either.

There is also **precedent for showing raw diff lines to users**: `GET
/api/changes` already returns `diff_text` capped at 4000 chars
(`changes.ts:29`), and `DiffPreview` (`competitor-detail/changes.tsx:126`)
already renders it as coloured `+` / `-` lines on the competitor Activity tab.
So this is not a policy line, it is an omission on one route.

## 4. Per source: what the reader actually gets

`SYNTHETIC_DOC_SOURCES` (`scrape-monitor.ts:160`) is the tell. Nine sources
(`sitemap`, `news`, `github_repo`, `subdomains`, `youtube`, `hackernews`,
`wellknown`, `docs`, `roadmap`) render a synthesized, one-fact-per-line document
before diffing. Their diff lines are therefore already clean, readable facts:
one URL, one video title, one API endpoint, one roadmap entry. Those lines are
the best evidence in the product and none of them is displayed.

| Source | Shape of the change | What the signal shows today | What exists unused |
|---|---|---|---|
| homepage (structured) | typed per-field | full breakdown + before/after screenshots + narrative | fine, but only 45 of 97 homepage signals take this path |
| homepage (lexical fallback) | text | prose only, and it is 52 of 97 | diff lines |
| pricing | **set** of plan rows in practice | 55 of 97 have no pair at all | the plan rows, trial facts, the price ladder |
| jobs | **set** of N roles | prose only | every title/location/seniority/salary/apply URL |
| docs | **set** of endpoints and schema fields | prose only | `POST /v1/x` lines, deprecation markers |
| blog, changelog, news | **set** of entries | prose only | entry titles |
| sitemap | **set** of URLs | comparison pages get the URL as the pair; the rest gets prose | the URL delta |
| roadmap | **set** of entries | prose only | entry titles, status, vote band |
| subdomains, youtube | **set** | prose only | subdomain, video title |
| hackernews | one post | title plus a bare URL glued into the pair | points, comments, clean thread link |
| wellknown | one app or manifest | **nothing**: the pair is hardcoded null (`scrape-monitor.ts:1674`) | the bundle/package name is right there in the delta |
| reviews | score plus themes | pair on the shift detector only | sub-scores, verbatims, themes |
| tech_stack | one tech | tech name | category, importance, evidence |
| hiring_shift, ai_visibility | numeric | good pair (counts, percentages) | fine |
| custom, status | text | prose only | diff lines |

Pattern: **the pipe fails exactly where the source is richest.** A set-shaped
change is the case where naming the items matters most, and it is the case the
prompt is instructed to answer with null.

## 5. What to add

Three waves, cheapest and highest coverage first. Wave 1 alone fixes the
screenshot for thirteen sources at once.

### Wave 1: ship what is already stored (0 AI calls, 0 migrations)

1. **Diff lines on the signal.** Add capped `diff_text` to
   `GET /signals/:id/detail`, render with the existing `DiffPreview` inside the
   Evidence section, behind the existing "Show all N changes" disclosure. Covers
   jobs, docs, blog, changelog, news, sitemap, roadmap, subdomains, youtube,
   github_repo, custom, status, reviews. Measured recovery: 169 of the 170
   evidence-less signals carry lines.
   Effort: half a day.

   Three things to get right, all learned the hard way by the code that already
   exists:

   - **Send `diff_text`, not `raw_diff`.** `diffLines` groups consecutive changed
     lines into ONE part (`packages/shared/src/diff/index.ts:47`), so a
     `raw_diff.added` entry is a multi-line block, not a line. That is why the
     arrays look small (jobs averages 4 entries for 4289 chars of diff): the
     count is hunks, not lines. `diff_text` carries a marker on every physical
     line, and `splitDiffText` already splits it back.
   - **Reuse the whole existing chain**: `splitDiffText` (shared),
     `parseDiff` plus `stripHtml` plus `DiffPreview` (web). Nothing new to write
     on the rendering side.
   - **`parseDiff` currently emits every removed line before any added line, and
     caps at 18 total** (`competitor-detail/helpers.ts:20-35`). On a change with
     more than 18 removals, the additions never render at all. For a signal that
     is the wrong way round: the added side is usually the news, and a panel
     showing only what disappeared is precisely the polarity failure the diff
     labelling was built to prevent. Either lead with the added side or balance
     the two, and raise the cap for this surface.

2. **Explain the band.** Send `signals.materiality` and render three mini-scales
   in "Why this insight?": decision impact, urgency, corroboration, plus the one
   deterministic rule that produced the band ("critical needs 3 and 3"). Removes
   the Medium-versus-Low-threat contradiction without any new data.
   Effort: 2 to 3 hours.

3. **HN engagement on the signal.** Points, comment count and a real thread link
   instead of a URL pasted into an eight-word field. The data is already in
   `raw_diff` and already read by another route.
   Effort: 1 hour.

4. **Fill the wellknown pair.** `humanChangeAfter: app` instead of null. One
   line, turns an empty signal into a named one.
   Effort: 15 minutes.

### Wave 2: join the sibling facts (0 AI calls)

The extractors that hold the real facts run **in parallel** with the change that
becomes the signal, and the two never meet. Both `extractJobs.enqueue` and
`extractPricing.enqueue` fire at `scrape-monitor.ts:1801-1812`, where `changeId`
is already in scope (declared at `:1123`). So passing it down is one argument.

5. **Stamp the change on the extracted rows**, then render a per-category fact
   block on the signal:
   - hiring: the roles inserted for that change, as title, seniority, location,
     with the apply link. That is the literal answer to "which hires?".
   - pricing: plan, old to new, period, trial facts.
   - reviews: score, sub-scores, the complaint themes that moved.
   - tech: name, category, importance, evidence.

   Two ways to link them. (a) Time-window join on `detected_at` around the
   change: no migration, slightly fuzzy when two scrapes land close together.
   (b) `job_postings.change_id` and equivalents: one migration, exact, and it
   makes "what did this signal actually consist of" answerable forever. Prefer
   (b) for jobs and pricing, since the enqueue site already has the id.
   Effort: about a day for hiring plus pricing, half a day for the rest.

### Wave 3: facts we could compute but do not (deterministic, cheap)

6. **Comparative context.** A competitor price change means nothing without
   ours. The self-competitor already carries our pricing, so the signal can say
   "us 29, them 79 to 59".
7. **Historical context.** "Third pricing move in 60 days", "first hiring push
   since March". One query over `signals` and the analytics tables.
8. **Corroboration made visible.** The classifier already scores corroboration
   from the last five signals of that competitor; naming those signals turns a
   number into a link.
9. **Capture provenance.** When the page was captured, when the source last
   changed, whether the capture was graded partial. Today a signal cannot be
   distinguished from a stale one.

### Prompt-level fix, decide alongside wave 1

10. The classifier's "single most important change, at most eight words, else
    null" rule is right for a price and wrong for a set. Two options: allow a
    short list for set-shaped sources, or accept that the pair is a
    single-value device and let waves 1 and 2 carry sets. Recommendation: leave
    the prompt alone and let the diff lines and the fact block carry sets. The
    pair stays what it is good at, and no eval has to be re-run.

## 6. Ranking if only one thing ships

Wave 1 item 1. It is half a day, it adds no AI cost, it needs no migration, it
reuses a component that already ships to users, and it is the only item that
reaches all 299 signals with no breakdown at once.

Second, and this is what the prod numbers changed: **the pricing fact block from
wave 2**. 97 signals, 55 of them with no evidence, on the source where a fact is
worth the most money, with the plan rows already written by the same scrape.
Before the measurement this looked like the one source that was already fine.

## 7. Open questions

- Raw page text as evidence is honest but ugly on `jobs` and `custom` (nav
  boilerplate leaks in). Do we ship it raw first and clean per source later, or
  clean upfront for the two noisiest?
- The window-join versus `change_id` decision in wave 2 is the only migration in
  this document. Worth doing properly if we ever want "what did this signal
  consist of" to be auditable.
- Not yet measured: how many of the 299 breakdown-less signals actually carry
  usable `raw_diff.added` / `removed` lines. That number is wave 1's real
  recovery rate, and a change whose arrays are empty would render an empty
  Evidence block, which is worse than no block. Worth knowing before building
  the UI.
