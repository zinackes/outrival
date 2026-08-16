export const meta = {
  name: 'audit-ux',
  description: 'Exhaustive product and UX audit of Outrival: two live browser passes, then 15 angles',
  whenToUse: 'Session 2 of the audit charted in docs/audits/2026-08-16/PLAN.md. Run crawl.mjs first.',
  phases: [
    { title: 'Live: flows' },
    { title: 'Live: adversarial' },
    { title: 'Angles' },
    { title: 'Synthesis' },
  ],
}

const OUT = (args && args.outDir) || '/home/tmfzi/.outrival-audit/2026-08-16'
const WEB = (args && args.webUrl) || 'https://outrival.app'
const REPO = '/home/tmfzi/outrival'

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
          detail: { type: 'string', description: 'Three sentences at most' },
          impact: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

/** The Playwright MCP drives a single browser instance, so the live passes are
 *  serialised. Never move them into the parallel block below. */
const BROWSER_BASE = `You are driving the ONE browser available in this audit.
Use the Playwright MCP tools (find them with ToolSearch, query "playwright").
The session cookie is already valid at ${OUT}/../state.json; if the MCP browser
starts logged out, say so and stop rather than trying to sign in, because the
account uses Google OAuth.

Target: ${WEB}. ${CONTEXT}

FORBIDDEN, without exception:
- /dashboard/settings/danger: never delete an account, an organisation or data.
- /dashboard/settings/billing: never change, cancel or upgrade a plan. Stripe is
  in LIVE mode. You may look at the page, you may not act on it.
- Never invite a real person by email.

AI actions are capped at 10 per hour on every tier. A 429 or a quota message is
expected behaviour, not a bug: record it and move on.`

const FLOWS_PROMPT = `${BROWSER_BASE}

THIS PASS IS THE HAPPY PATH. Walk the product the way a paying user would, and
report anything that breaks, confuses, or takes too long.

1. Walk the full add-product flow, including discovery, end to end.
2. Add a competitor and watch what happens until a signal or an error appears.
3. Generate a battle card and export its PDF.
4. Run an "Ask Outrival" query.
5. Create a share link so that /brief/<id> and /report/<token> exist, then visit
   both and screenshot them. These two routes could not be crawled because they
   do not exist until a share is created. REPORT THEIR URLS, the next pass and
   the angle agents need them.
6. Walk the settings pages that are safe to touch: profile, notifications,
   integrations, team. Change a preference and confirm it persists on reload.

Spend at most 6 AI actions.

A flow that technically works but leaves the user unsure what happens next is a
finding. So is a spinner with no end state, a success with no confirmation, and
a step whose purpose is not obvious from the screen.`

const ADVERSARIAL_PROMPT = `${BROWSER_BASE}

THIS PASS IS ADVERSARIAL. The happy path was already walked in a previous pass.
Your job is to break things that a normal click-through never touches.

1. FORMS. On every form you can reach: submit it empty, submit an invalid URL,
   submit a duplicate of something that already exists, paste 5000 characters
   into a short text field, and submit twice fast. Where does the error appear,
   is it readable, does it say what to do, does the field keep the user's input?
2. NAVIGATION. Use the browser back button after a mutation. Reload mid-flow.
   Open a deep link to a nested page directly. Navigate away from a form with
   unsaved changes.
3. KEYBOARD ONLY. Tab through the dashboard shell and one data-heavy page.
   Can you reach every control? Is focus ever visible? Can you escape a modal?
   Does focus get trapped anywhere it should not?
4. NOT-FOUND AND FORBIDDEN. Visit a competitor id that does not exist, a product
   id belonging to nobody, and a share token you invent. What renders? A useful
   page, a raw error, or a blank screen?
5. SLOW AND OFFLINE. If the MCP exposes network throttling or offline mode, load
   a data-heavy dashboard page under it and describe what the user sees while
   waiting and what they see when it fails.

Spend at most 2 AI actions here, the previous pass already used the budget.

Report exactly what you did and what happened. An input you could not reach is
a notAudited entry, not a finding.`

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
    key: 'information-architecture',
    model: 'sonnet',
    prompt: `Judge whether a user can FIND things. Map the dashboard navigation
from the screenshots: what is in the sidebar, what is buried, what appears twice
under different names, what has no entry point at all. Then ask, for each of the
main jobs the product does (monitor a competitor, read a signal, get a digest,
build a battle card, ask a question): how many clicks from the dashboard root,
and would a new user guess the path? Name every page that is reachable only by
knowing its URL.`,
  },
  {
    key: 'onboarding',
    model: 'sonnet',
    prompt: `Reconstruct the first-run experience. Read the onboarding and
wizard components under ${REPO}/apps/web/src, plus the screenshots for the
signup, onboarding and add-product routes. Trace the path from account creation
to the FIRST moment the user sees something valuable. How many steps, how much
typing, how long until the first signal exists? What can go wrong on the way,
and does the product recover or dead-end? Say clearly which parts you judged
from source rather than from a live run.`,
  },
  {
    key: 'visual-consistency',
    model: 'sonnet',
    prompt: `Compare screenshots ACROSS routes at the laptop viewport and find
where the product stops looking like one product: inconsistent spacing, heading
scales, button variants, card treatments, icon weights, page-header patterns,
loading treatments. Sample broadly across public and dashboard routes rather
than reading every file. Name the outlier route and the majority pattern it
departs from.`,
  },
  {
    key: 'dark-mode',
    model: 'sonnet',
    prompt: `Compare every route's light and dark screenshots SIDE BY SIDE and
find where dark mode was an afterthought: text that loses contrast, borders that
vanish into the background, charts whose colours were tuned for light only,
images or logos with a baked white background, shadows that read as smudges,
overlays and modals that stay light, and any element that simply disappears.
Report by component where you can identify it, not only by route.`,
  },
  {
    key: 'responsive',
    model: 'sonnet',
    prompt: `Read ONLY the mobile and tablet screenshots plus every record in
failures.json with overflowPx greater than 1. The crawl already found a
consistent horizontal overflow at the 768 tablet width on dashboard routes:
establish how widely it spreads and what element causes it. Then look for touch
targets that are too small, text truncated or overlapping, tables that do not
adapt, and navigation that becomes unreachable.`,
  },
  {
    key: 'accessibility',
    model: 'sonnet',
    prompt: `Aggregate every axe violation across results.json. Group BY RULE,
not by route: the same global violation repeated on 80 pages is one finding with
a wide blast radius, not 80 findings. For each rule, give the node count, the
worst-affected routes, and where in the code the offending component most likely
lives. The crawl already saw button-name and color-contrast on the dashboard
shell. Check contrast in BOTH themes, they fail differently. The product ships a
public /accessibility page, so treat its claims as promises to verify.`,
  },
  {
    key: 'forms-inputs',
    model: 'sonnet',
    prompt: `Audit every form in the product from source, under
${REPO}/apps/web/src. For each: does every input have a real label rather than
a placeholder standing in for one? Where does the validation error render, and
is it associated with the field for a screen reader? Is the submit button
disabled while pending, and does double-submit create two rows? Are destructive
actions confirmed? Do date inputs use the shared shadcn date-range picker as the
product rules require?`,
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
sourced and traceable back to evidence, is it something a real user would act
on, does it hedge or repeat itself, does it read as machine-generated filler?
Quote the weakest examples you can see verbatim from the screenshots.`,
  },
  {
    key: 'copy-language',
    model: 'sonnet',
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
components under ${REPO}/apps/web/src and judge what a brand-new user would see
on each dashboard route before any data exists. Does every list, chart and panel
have a defined empty state? Does each one tell the user what to do next, or is
it a blank card? Then cross-check the error boundaries: what does a failed fetch
render? Say clearly that this angle was audited from source, not from a live
empty account.`,
  },
  {
    key: 'perceived-performance',
    model: 'sonnet',
    prompt: `Read the ms field across results.json and rank the routes by load
time. For the slowest ten, look at their screenshots and at the components that
render them: what is the user staring at while they wait, a skeleton that
matches the final layout or a blank page that then jumps? Look for layout shift
between the skeleton and the content, spinners with no bounded end, and any page
that fetches serially what it could fetch at once. Give numbers, not adjectives.`,
  },
  {
    key: 'trust-legal',
    model: 'sonnet',
    prompt: `Audit the promises the public site makes. Read the screenshots and
source for /privacy, /terms, /security, /accessibility, /bot and any trust or
compliance copy on / and /pricing. Then check each claim against what the
product actually does: does the stated data retention match the schema, does the
stated scraping behaviour match the collection doctrine in
${REPO}/.claude/rules/scraping.md, does the accessibility statement match the
axe results, is there a stated support or response commitment nobody owns? An
unkeepable promise on a public page is a real finding.`,
  },
  {
    key: 'emails-exports',
    model: 'sonnet',
    prompt: `Audit the generated artifacts. Use the /dev/preview-emails and
/dev/preview screenshots for the Resend digests and alerts, and check them for:
English only, working dark mode, sane rendering at narrow widths, no broken
layout, a clear call to action, a working unsubscribe path. Then review the
battle-card PDF path in ${REPO}/packages and ${REPO}/apps for lang="en" and
en-US date formatting.`,
  },
]

/* -------------------------------------------------------------------------- */

phase('Live: flows')
log('One browser, one agent. The MCP drives a single instance.')

const flows = await agent(FLOWS_PROMPT, {
  model: 'sonnet',
  label: 'live:flows',
  phase: 'Live: flows',
  schema: FINDING_SCHEMA,
})

phase('Live: adversarial')
log('Same browser, second pass. Serialised on purpose.')

const adversarial = await agent(
  `${ADVERSARIAL_PROMPT}

WHAT THE PREVIOUS PASS REPORTED, so you do not repeat it:
${JSON.stringify(flows ? flows.findings.map((f) => f.title) : [])}`,
  {
    model: 'sonnet',
    label: 'live:adversarial',
    phase: 'Live: adversarial',
    schema: FINDING_SCHEMA,
  },
)

/* -------------------------------------------------------------------------- */

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
reach a defensible conclusion.

OUTPUT. Findings only, no fixes. Every finding needs at least one concrete piece
of evidence: a route URL, a screenshot filename, or a file:line. Never report
something you have not actually looked at. Keep detail to three sentences. If a
check was impossible, put it in notAudited instead of guessing.`,
      { model: a.model, label: `angle:${a.key}`, phase: 'Angles', schema: FINDING_SCHEMA },
    )),
)).filter(Boolean)

const all = [flows, adversarial, ...analyses].filter(Boolean)
const total = all.reduce((n, r) => n + r.findings.length, 0)
log(`${total} raw findings across ${all.length} angles`)

/* -------------------------------------------------------------------------- */

phase('Synthesis')

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const bySeverity = new Map()
for (const r of all) {
  for (const f of r.findings) {
    const sev = f.severity || 'minor'
    if (!bySeverity.has(sev)) bySeverity.set(sev, [])
    bySeverity.get(sev).push({ ...f, angle: r.angle })
  }
}

const MERGED_SCHEMA = {
  type: 'object',
  required: ['severity', 'findings'],
  properties: {
    severity: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'evidence', 'impact', 'effort', 'confidence'],
        properties: {
          title: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          detail: { type: 'string' },
          impact: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          seenByAngles: { type: 'array', items: { type: 'string' } },
          blastRadius: { type: 'string', description: 'How many routes or components, if it repeats' },
        },
      },
    },
  },
}

const merged = (await parallel(
  [...bySeverity.entries()].map(([severity, list]) => () =>
    agent(
      `Deduplicate the "${severity}" UX findings from an audit of Outrival. They
come from ${all.length} independent angles, so the same defect appears more than
once described differently: an overflow seen by both responsive and
visual-consistency, a contrast failure seen by both accessibility and dark-mode.

${JSON.stringify(list)}

TASK:
1. Merge findings describing the SAME defect. Keep the best evidence, and list
   every angle that saw it in seenByAngles. Agreement across angles is signal.
2. Collapse a defect repeated across many routes into ONE finding carrying its
   blastRadius, rather than one per route.
3. Sort by leverage: impact divided by effort, weighted by confidence.
4. Return the merged list. Do not add findings, do not invent evidence, do not
   raise anyone's confidence. Verification happens in a later session.`,
      { model: 'sonnet', label: `merge:${severity}`, phase: 'Synthesis', schema: MERGED_SCHEMA },
    )),
)).filter(Boolean)

const flat = merged.flatMap((m) => m.findings.map((f) => ({ ...f, severity: m.severity })))
const notAudited = all.map((r) => `${r.angle}: ${r.notAudited}`).filter((s) => !s.endsWith(': '))

const writer = await agent(
  `Write the merged UX findings for Outrival to disk.

Use the Write tool to create ${OUT}/findings-ux.json with this shape:
{ "findings": [...], "notAudited": [...] }

FINDINGS (${flat.length}):
${JSON.stringify(flat)}

NOT AUDITED (${notAudited.length} entries):
${JSON.stringify(notAudited)}

Do not edit, reword, filter or re-rank. This step is transcription.
After writing, return ONLY: totals per severity, and the titles of the twenty
highest-leverage findings. Do NOT return the full list.`,
  { model: 'sonnet', label: 'write', phase: 'Synthesis' },
)

return {
  angles: all.map((r) => r.angle),
  rawFindings: total,
  mergedFindings: flat.length,
  shareUrls: 'reported by live:flows, check its output for /brief and /report',
  writtenTo: `${OUT}/findings-ux.json`,
  summary: writer,
}
