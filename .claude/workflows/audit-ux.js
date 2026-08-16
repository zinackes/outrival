export const meta = {
  name: 'audit-ux',
  description: 'Product and UX audit of Outrival from crawl artifacts, plus one live browser pass',
  whenToUse: 'Phase 3 of the audit charted in docs/audits/2026-08-16/PLAN.md. Run crawl.mjs first.',
  phases: [{ title: 'Live flows' }, { title: 'Angles' }, { title: 'Synthesis' }],
}

const OUT = (args && args.outDir) || '/home/tmfzi/.outrival-audit/2026-08-16'
const WEB = (args && args.webUrl) || 'https://outrival.app'

const ARTIFACTS = `
Crawl artifacts, already on disk, produced by a read-only pass over 80 routes in
4 viewports (mobile 390, tablet 768, laptop 1280, desktop 1920) and 2 themes:

  ${OUT}/routes.json         every route crawled, with its group
  ${OUT}/results.json        one record per route x viewport x theme
  ${OUT}/failures.json       only the records that tripped a check
  ${OUT}/session-check.json  the account plan in use
  ${OUT}/shots/              screenshots, named <path>__<viewport>__<theme>.jpg
                             where <path> is the route with / replaced by _

Each record carries: status, title, h1, overflowPx, textLength, ms,
consoleErrors, pageErrors, httpErrors, failedRequests, hydration, and axe
violations for the laptop and mobile viewports.
`

const CONTEXT = `
Outrival is a competitive-intelligence SaaS: it monitors competitors and
generates AI insights, digests and battle cards.

THE ACCOUNT USED IS ON THE PRO PLAN AND IS NOT AN ADMIN. Anything gated behind a
higher tier, or behind admin rights, is gated BY DESIGN. Do not report a gate as
a bug. The 23 pages under /admin were not crawled at all for this reason.

The account is well populated, so genuine empty states are not reachable in the
screenshots. There is no second account, so cross-organisation access could not
be tested from the browser.

PRODUCT RULES THAT ARE NOT UP FOR DEBATE:
- Everything user-facing ships in ENGLISH. A French string in the UI, an email,
  a date format or a persisted enum value is a defect, always.
- No em-dash characters in product copy.
- Monospace type is for keyboard keys, ids, URLs and code only, never prose.
- Date filters use the shared shadcn date-range picker.
`

const FINDING_SCHEMA = {
  type: 'object',
  required: ['angle', 'findings', 'notAudited'],
  properties: {
    angle: { type: 'string' },
    notAudited: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'evidence', 'impact', 'effort', 'confidence'],
        properties: {
          title: { type: 'string', description: 'Short imperative title' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'polish'] },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Route URLs, screenshot filenames, or file:line. At least one.',
          },
          detail: { type: 'string' },
          impact: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

/** Exactly one agent gets the browser. The Playwright MCP drives a single
 *  instance, so two agents navigating at once would fight over the same tab. */
const BROWSER_PROMPT = `You are the only agent in this audit allowed to drive a
browser. Use the Playwright MCP tools (find them with ToolSearch, query
"playwright"). The session cookie is already valid at ${OUT}/../state.json; if
the MCP browser starts logged out, say so and stop rather than trying to sign in,
because the account uses Google OAuth.

Target: ${WEB}. ${CONTEXT}

YOU MAY MUTATE. Create things, fill forms, trigger generation. Specifically:

1. Walk the full add-product flow, including discovery, end to end.
2. Add a competitor and watch what happens until a signal or an error appears.
3. Generate a battle card and export its PDF.
4. Run an "Ask Outrival" query.
5. Create a share link so that /brief/<id> and /report/<token> exist, then visit
   both and screenshot them. These two routes could not be crawled because they
   do not exist until a share is created. Report their URLs.
6. Provoke error states on purpose: submit an empty required field, an invalid
   URL, a duplicate entry.

FORBIDDEN, without exception:
- /dashboard/settings/danger: never delete an account, an organisation or data.
- /dashboard/settings/billing: never change, cancel or upgrade a plan. Stripe is
  in LIVE mode. You may look at the page, you may not act on it.
- Never invite a real person by email.

BUDGET. AI actions are capped at 10 per hour for every tier. Steps 3 and 4 above
consume from that budget. Spend at most 6 AI actions in total, and if you hit a
429 or a quota message, record it as expected behaviour and move on. It is not a
bug.

Report what broke, what confused you, what took too long, and every dead end. A
flow that technically works but leaves the user unsure what happens next is a
finding.`

const ANGLES = [
  {
    key: 'landing',
    model: 'sonnet',
    prompt: `Judge the public site as a first-time visitor who has never heard of
Outrival and is evaluating three competing tools. Read the screenshots for /,
/pricing, /demo, /sample, /about, /vs/*, /alternatives/*.
Answer concretely: within five seconds, do I know what this does and who it is
for? What is the single strongest objection the page fails to answer? Is the
pricing legible, and do I know which plan is mine? What would make me leave?
Be blunt. Vague praise is worthless here.`,
  },
  {
    key: 'visual-consistency',
    model: 'sonnet',
    prompt: `Compare screenshots ACROSS routes at the laptop viewport, both
themes, and find where the product stops looking like one product: inconsistent
spacing, heading scales, button variants, card treatments, icon weights, empty
and loading treatments, page-header patterns. Sample broadly across public and
dashboard routes rather than reading every file. Name the outlier route and the
majority pattern it departs from.`,
  },
  {
    key: 'responsive',
    model: 'sonnet',
    prompt: `Read ONLY the mobile and tablet screenshots plus every record in
failures.json with overflowPx greater than 1. The crawl already found a
consistent horizontal overflow at the 768 tablet width on dashboard routes:
establish how widely it spreads and what element causes it. Then look for
touch targets that are too small, text that is truncated or overlapping, tables
that do not adapt, and navigation that becomes unreachable.`,
  },
  {
    key: 'accessibility',
    model: 'sonnet',
    prompt: `Aggregate every axe violation across results.json. Group BY RULE,
not by route: the same global violation repeated on 80 pages is one finding with
a wide blast radius, not 80 findings. For each rule, give the node count, the
worst-affected routes, and where in the code the offending component most likely
lives. The crawl already saw button-name and color-contrast on the dashboard
shell. Also check colour contrast in BOTH themes, since dark and light fail
differently. The product ships a public /accessibility page, so treat its claims
as promises to verify.`,
  },
  {
    key: 'seo-aeo',
    model: 'sonnet',
    prompt: `Audit the public and programmatic pages for discoverability: title
and h1 from results.json, meta descriptions, canonical tags, Open Graph, JSON-LD
structured data, sitemap and robots coverage, heading hierarchy, internal
linking between /vs/*, /alternatives/* and /blog/*. Fetch the raw HTML of a
sample of pages if you need the head tags. Flag duplicate or missing titles,
thin pages, and orphan pages absent from the sitemap.`,
  },
  {
    key: 'ai-content',
    model: 'sonnet',
    prompt: `The AI output is the product. From the dashboard screenshots
covering signals, digests, battle cards, trends, sector, ai-visibility, recap and
ask, judge the CONTENT rather than the layout: is it specific or generic, is it
sourced and traceable back to evidence, is it something a real user would act on,
does it hedge or repeat itself, does it read as machine-generated filler? Quote
the weakest examples you can see verbatim from the screenshots.`,
  },
  {
    key: 'copy-language',
    model: 'haiku',
    prompt: `Mechanical sweep, no judgement calls. Across all screenshots and the
title and h1 fields of results.json, list every occurrence of: French text in the
UI, French date formats, em-dash characters in copy, monospace type used on
prose, inconsistent capitalisation in buttons and headings, and placeholder text
that shipped by accident such as lorem, TODO or TBD. Report the exact string and
where you saw it. Do not editorialise.`,
  },
  {
    key: 'empty-error-states',
    model: 'sonnet',
    prompt: `No fresh account exists, so genuine empty states are unreachable in
the screenshots. Work from the code instead: read the empty-state and error
components under /home/tmfzi/outrival/apps/web/src and judge what a brand-new
user would see on each dashboard route before any data exists. Does every list,
chart and panel have a defined empty state? Does each one tell the user what to
do next, or is it a blank card? Then cross-check the error boundaries: what does
a failed fetch render? Say clearly that this angle was audited from source, not
from a live empty account.`,
  },
  {
    key: 'emails-exports',
    model: 'sonnet',
    prompt: `Audit the generated artifacts. Use the /dev/preview-emails and
/dev/preview screenshots for the Resend digests and alerts, and check them for:
English only, working dark mode, sane rendering at narrow widths, no broken
layout, a clear call to action. Then review the battle-card PDF path in
/home/tmfzi/outrival/packages and apps for lang="en" and en-US date formatting.`,
  },
]

phase('Live flows')
log('One agent drives the browser, alone: the MCP browser is a single instance')

const live = await agent(BROWSER_PROMPT, {
  model: 'sonnet',
  label: 'live-flows',
  phase: 'Live flows',
  schema: FINDING_SCHEMA,
})

phase('Angles')
log(`${ANGLES.length} analysis agents reading artifacts in parallel`)

const analyses = (await parallel(
  ANGLES.map((a) => () =>
    agent(
      `You are auditing Outrival on ONE angle: ${a.key}

${a.prompt}

${ARTIFACTS}
${CONTEXT}

METHOD. Read the artifacts, not the whole repo. Screenshots are images, open
them with the Read tool. Sample deliberately: you do not need all 640 records to
reach a defensible conclusion, and reading everything wastes the budget.

OUTPUT. Findings only, no fixes. Every finding needs at least one concrete
piece of evidence: a route URL, a screenshot filename, or a file:line. Never
report something you have not actually looked at. If a check was impossible,
put it in notAudited instead of guessing.`,
      { model: a.model, label: `angle:${a.key}`, phase: 'Angles', schema: FINDING_SCHEMA },
    )),
)).filter(Boolean)

const all = [live, ...analyses].filter(Boolean)
const total = all.reduce((n, r) => n + r.findings.length, 0)
log(`${total} raw findings across ${all.length} angles`)

phase('Synthesis')

const synthesis = await agent(
  `Here are raw UX and product findings from ${all.length} audit angles on
Outrival.

${JSON.stringify(all)}

TASK, in this order:
1. Merge duplicates. The same defect will surface from several angles, for
   example one overflow reported by both responsive and visual-consistency. Keep
   the best evidence and note which angles saw it.
2. Collapse repeated global defects into a single finding with its blast radius,
   rather than one finding per affected route.
3. Sort by leverage: impact divided by effort, weighted by confidence, with
   blockers first.
4. Write the full merged result as JSON to ${OUT}/findings-ux.json using the
   Write tool, including a notAudited array collecting what each angle skipped.
5. Return ONLY a compact summary: totals per severity, and the titles of the
   fifteen highest-leverage findings. Do NOT return the full list.

These findings are UNVERIFIED. Do not raise anyone's confidence. Verification
happens later on the main model.`,
  { model: 'sonnet', label: 'synthesis', phase: 'Synthesis' },
)

return {
  angles: all.map((r) => r.angle),
  rawFindings: total,
  writtenTo: `${OUT}/findings-ux.json`,
  summary: synthesis,
}
