#!/usr/bin/env node
/**
 * Deterministic triage between the finding passes and the refutation workflow.
 *
 * Phase 4 used to cost one agent per (finding x lens): 360 findings became ~850
 * agents, roughly 15 quota windows, so it could never finish. This script does
 * the part that never needed a model: dedup, split off what will not become a
 * ticket, and pack the rest into batches that share a file so one agent opens
 * that file once and judges everything cited in it.
 *
 * Writes triage.json next to the findings. Feed it to audit-verify as `args`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.env.AUDIT_OUT || `${process.env.HOME}/.outrival-audit/2026-08-16`

/** Categories that describe work to schedule, not a defect to disprove. They go
 *  to the annex: cheap to judge by hand, and an adversarial refuter adds nothing. */
const ANNEX_CATEGORIES = new Set(['tests', 'debt', 'docs', 'dependencies'])
const ANNEX_SEVERITIES = new Set(['polish'])

const HIGH_CATEGORIES = new Set(['security', 'correctness'])
const HIGH_SEVERITIES = new Set(['blocker'])

const BATCH_LOW = 8
const BATCH_HIGH = 6

const read = (name) => JSON.parse(readFileSync(join(OUT, name), 'utf8'))

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** First real path in the evidence, used both to group and to tell the agent
 *  what to open. Falls back to the package, then to a route for UX findings. */
function anchorOf(f) {
  const hay = [f.title, ...(f.evidence || [])].join(' ')
  const file = hay.match(/(?:packages|apps|scripts|docs)\/[\w./-]+\.(?:ts|tsx|js|mjs|sql|json)/)
  if (file) return file[0]
  const bare = hay.match(/\b[\w-]+\.(?:ts|tsx|mjs|sql)\b/)
  if (bare) return bare[0]
  const route = hay.match(/\/(?:dashboard|settings|admin|brief|report|onboarding)[\w/-]*/)
  if (route) return route[0].replace(/\/[0-9a-f]{8}-[0-9a-f-]+/g, '/:id')
  return f.package || 'misc'
}

function load() {
  const code = read('findings-code.json')
  const ux = read('findings-ux.json')

  const all = []
  code.findings.forEach((f) => {
    all.push({
      key: `code:${f.id}`,
      source: 'code',
      title: f.title,
      evidence: f.evidence || [],
      impact: f.impact,
      effort: f.effort,
      confidence: f.confidence,
      category: f.category,
      package: f.package,
      anchor: anchorOf(f),
    })
  })
  ux.findings.forEach((f, i) => {
    all.push({
      key: `ux:${String(i).padStart(2, '0')}`,
      source: 'ux',
      title: f.title,
      evidence: f.evidence || [],
      impact: f.impact,
      effort: f.effort,
      confidence: f.confidence,
      severity: f.severity,
      blastRadius: f.blastRadius,
      anchor: anchorOf(f),
    })
  })

  const notAudited = [...(code.notAudited || []), ...(ux.notAudited || [])].map((x) =>
    typeof x === 'string' ? x : JSON.stringify(x),
  )
  return { all, notAudited }
}

/** Conservative: only an identical normalised title collapses. Anything looser
 *  merges two real defects into one and loses the second. */
function dedupe(findings) {
  const seen = new Map()
  const kept = []
  for (const f of findings) {
    const k = norm(f.title)
    const prev = seen.get(k)
    if (prev) {
      prev.mergedFrom = prev.mergedFrom || []
      prev.mergedFrom.push(f.key)
      prev.evidence = [...new Set([...prev.evidence, ...f.evidence])]
      continue
    }
    seen.set(k, f)
    kept.push(f)
  }
  return kept
}

function isHigh(f) {
  if (f.confidence === 'low') return true
  if (f.source === 'code') return HIGH_CATEGORIES.has(f.category)
  return HIGH_SEVERITIES.has(f.severity)
}

function isAnnex(f) {
  if (f.confidence === 'low') return false
  if (f.source === 'code') return ANNEX_CATEGORIES.has(f.category)
  return ANNEX_SEVERITIES.has(f.severity)
}

/** Group by anchor so an agent opens one file for the whole batch, then pack
 *  groups up to the cap. A group larger than the cap splits rather than
 *  overflowing: 21 findings on one file is three passes over that file. */
function batch(findings, cap, prefix) {
  const groups = new Map()
  for (const f of findings) {
    if (!groups.has(f.anchor)) groups.set(f.anchor, [])
    groups.get(f.anchor).push(f)
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  const batches = []
  let current = []
  const flush = () => {
    if (!current.length) return
    batches.push({
      id: `${prefix}-${String(batches.length + 1).padStart(2, '0')}`,
      stakes: prefix,
      anchors: [...new Set(current.map((f) => f.anchor))],
      findings: current,
    })
    current = []
  }

  for (const [, group] of ordered) {
    if (group.length >= cap) {
      for (let i = 0; i < group.length; i += cap) {
        flush()
        current = group.slice(i, i + cap)
        flush()
      }
      continue
    }
    if (current.length + group.length > cap) flush()
    current.push(...group)
  }
  flush()
  return batches
}

const { all, notAudited } = load()
const deduped = dedupe(all)
const annex = deduped.filter(isAnnex)
const toRefute = deduped.filter((f) => !isAnnex(f))
const high = toRefute.filter(isHigh)
const low = toRefute.filter((f) => !isHigh(f))

const batches = [...batch(high, BATCH_HIGH, 'high'), ...batch(low, BATCH_LOW, 'low')]

const out = {
  counts: {
    loaded: all.length,
    deduped: deduped.length,
    merged: all.length - deduped.length,
    annex: annex.length,
    refute: toRefute.length,
    high: high.length,
    low: low.length,
    batches: batches.length,
    highBatches: batches.filter((b) => b.stakes === 'high').length,
  },
  batches,
  annex: annex.map((f) => ({ key: f.key, title: f.title, category: f.category, severity: f.severity })),
  notAudited,
}

/* The workflow script has no filesystem access, so it cannot read this. It gets
 * the small index through `args` and each agent opens its own batch file. */
const dir = join(OUT, 'triage')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const b of batches) writeFileSync(join(dir, `${b.id}.json`), JSON.stringify(b, null, 2))

writeFileSync(join(OUT, 'triage.json'), JSON.stringify(out, null, 2))
writeFileSync(join(dir, 'annex.json'), JSON.stringify(out.annex, null, 2))
writeFileSync(join(dir, 'not-audited.json'), JSON.stringify(out.notAudited, null, 2))

/* Deliberately tiny: this whole object is pasted into the Workflow call as
 * `args`. Anything an agent can open for itself stays on disk. */
writeFileSync(
  join(OUT, 'triage-index.json'),
  JSON.stringify(
    {
      counts: out.counts,
      outDir: OUT,
      dir,
      annexFile: join(dir, 'annex.json'),
      notAuditedFile: join(dir, 'not-audited.json'),
      batches: batches.map((b) => ({
        id: b.id,
        stakes: b.stakes,
        file: join(dir, `${b.id}.json`),
        size: b.findings.length,
        anchors: b.anchors,
        // Kept so the workflow can tell a missing verdict from a skipped
        // finding: no verdict at all must count as a refutation, not vanish.
        keys: b.findings.map((f) => f.key),
      })),
    },
    null,
    2,
  ),
)

const c = out.counts
console.log(`loaded      ${c.loaded}  (${c.merged} merged as exact duplicates)`)
console.log(`annex       ${c.annex}  (not refuted, listed in the report for manual triage)`)
console.log(`to refute   ${c.refute}  = ${c.high} high stakes + ${c.low} low`)
console.log(`batches     ${c.batches}  (${c.highBatches} high, get a second independent agent)`)
console.log(`agents      ~${c.batches + c.highBatches} for the refute phase`)
console.log(`written     ${join(OUT, 'triage-index.json')}  + ${dir}/`)
