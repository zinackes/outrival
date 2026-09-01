# Outrival audit, 2026-08-16

Full-surface audit of the monorepo and of the live product at `https://outrival.app`
/ `https://api.outrival.app`, run in three sessions against `PLAN.md` (the charter)
and `RUN.md` (the runbook), both in this directory.

Written by the session's main model from `~/.outrival-audit/2026-08-16/findings-verified.json`.
No sub-agent wrote any part of this file.

## How to read this

Four buckets, and the difference between them is the whole point of the exercise:

| Section | Count | What it means |
|---|---:|---|
| [6. Verified](#6-verified-findings-182) | 182 | An independent agent read the cited code and **tried to kill it and failed** |
| [7. Not refuted](#7-findings-not-put-through-refutation-70) | 70 | Real observations, but **nobody tried to kill them**. No vote, no confirmation |
| [8. Considered and rejected](#8-considered-and-rejected-26) | 26 | Killed, with the refuter's reason reproduced verbatim |
| [9. Annex](#9-annex-routed-out-of-scope-never-contested-139) | 139 | Routed out of scope before phase 4. **Not refuted**, and not confirmed either |

Nothing in section 7 or section 9 has been confirmed by anyone. Some of section 7
is nonetheless the most urgent material in the report, because the gap sweep is
where production telemetry entered the audit. That tension is left visible rather
than resolved by quietly promoting things.

Finding titles, evidence, impacts and refutation reasons are reproduced verbatim
from the agents that wrote them, punctuation included. Only the surrounding prose
is the report author's.

## 1. Verdict

Nothing found in this audit is a live, exploitable cross-tenant breach in the
running product, with one exception that is one line of code away from being one.
The security picture is a codebase that gets the hard parts right (SSRF guards,
grounding, tenant scoping, step-up re-auth all exist and are used) and then has a
handful of paths that bypass its own primitives, usually because a second
implementation grew next to the first one.

Five things deserve to be looked at before anything else:

1. **`GET /api/feedback` returns every organisation's feedback rows.** No `orgId`
   filter at all, gated only by the caller's own per-org `owner` role instead of
   the platform admin allowlist used everywhere else. Any self-signed-up owner
   reads every other tenant's feedback. Found independently by a code agent
   (`code:COR-01`, verified) and again by a gap probe. Effort S, fix risk low.
2. **An AI provider has been returning 402 for roughly eleven days and nothing
   noticed.** Status 402 is absent from `shouldFailover`'s list, so a
   credit-exhausted provider fails fast instead of failing over, never trips the
   breaker, never fires an ops alert, and fills the DLQ. The public status banner
   renders this as self-healing "degraded", never "down". This is an incident, not
   a finding. It comes from the gap sweep, so it is **unrefuted** (section 7.1).
3. **~859 `Failed query` errors in 30 days that match no finding on the board.**
   The gap sweep's best explanation is postgres.js's default prepared statements
   against the Neon pooled endpoint. Unrefuted, and needs a production check rather
   than a code change as its first step.
4. **The migration journal carries a live clock-skew entry today.** `idx 69` is
   timestamped 1 ms before `idx 68`. This is the exact defect that already caused
   migration 0062 to be silently skipped in production while the migrator reported
   success (`code:SEC-01` and `code:COR-08`, both verified, both high confidence).
   Any environment applying migrations from scratch through this range is exposed.
5. **The public legal pages publish `[À COMPLÉTER]` as the publisher's identity.**
   Legal Notice, Terms and Privacy all ship the literal placeholder where the
   company name, legal form, share capital, registered office and RCS belong, on a
   page that cites LCEN Article 6 by name, next to a Privacy Policy that leaves the
   GDPR data controller unidentified (`ux:78`, verified, high confidence, effort S).

Below that, the recurring shapes are: a second implementation of a guard that the
first implementation already got right (SSRF, escaping, eTLD+1, relative time,
freshness), N+1 database round trips in cron jobs and API routes (the single
largest category at 54 verified findings), and an accessibility story where the
site's own accessibility claim is contradicted by 1345 contrast-failing nodes
across 73 routes in both themes.

One finding is not about the codebase at all and is called out separately:
`code:SEC-39`, a prompt-injection attempt against the audit itself. See section 4.

## 2. What was audited, and what was not

### Covered

93 routes in `apps/web/src/app`: 35 public/marketing/legal, 35 authenticated
dashboard, 23 admin. All eight packages of the monorepo (`apps/web`, `apps/api`,
`apps/workers`, `packages/db`, `packages/ai`, `packages/scrapers`,
`packages/queue`, `packages/shared`) read by code agents across five lenses
(security, correctness, performance, tests, debt). A 640-load read-only crawl of
the live product at four viewports and two themes, with axe, screenshots and
overflow measurement. A live adversarial pass on the real production account.
Production telemetry: 30 days of Sentry, a 200-row dead-letter-queue sample, and
15 650 scrape-run aggregates from Neon.

All three telemetry collectors returned real data. **There is no telemetry `SKIP`
to declare.** The phase-4 critics read all three files.

### Explicitly NOT covered

Stated here because `PLAN.md` requires it, and because the absence of a finding in
these areas is not evidence of health:

- **The 23 admin pages rendered in a browser.** The audit account is not an admin.
  They were read as code (that is where `code:SEC-09`, `code:SEC-12`,
  `code:COR-23`, `code:COR-36`, `code:COR-37`, `code:PER-17` and `code:PER-22`
  come from) but never seen running.
- **Real onboarding of a new signup.** No second account existed.
- **Runtime multi-tenant isolation.** Same reason: with one account there is no
  second tenant to attempt to reach. Every tenant-isolation finding in this report
  is static analysis, including `code:COR-01`. Nobody proved the leak by
  performing it.
- **End-to-end Stripe payment flows.** Stripe is LIVE in production;
  `/dashboard/settings/billing` and `/dashboard/settings/danger` were off limits by
  charter.
- **Load and stress.** This audit measures correctness, not behaviour under load.
  Every performance finding in section 6.3 is read off the code's `await` and
  `Promise.all` structure, not measured. None of them carries a benchmark.
- **Real email deliverability.** Email rendering was audited from source; whether
  Resend actually delivers was not tested. `/dev/preview-emails` returned 404 at
  every viewport during the crawl, so even the rendering pass fell back to reading
  the templates.

### Not covered because the audit ran out of room

- **5 gap probes proposed in round 2 were dropped at the 15-per-round cap and never
  ran.** They are unexamined, not cleared.
- The 102 per-agent coverage statements (what each of the 87 agents deliberately did
  not read, and why) are preserved verbatim under `notAudited.fromAuditAgents` in
  `findings-verified.json`. They are the honest map of this audit's blind spots and
  are worth reading before concluding that any package is clean.

## 3. Method, and what "verified" is worth here

Three sessions, communicating only through files in `~/.outrival-audit/2026-08-16/`,
never through context.

- **Session 1, code.** Per-package, per-lens agents produced findings against the
  tree, with four prior audits injected so nothing already decided got
  re-discovered.
- **Session 2, product.** A read-only 640-load crawl, then agents over the crawl
  artefacts plus a live adversarial pass on production.
- **Session 3, refutation.** 360 findings in. `triage.mjs` deduplicated them and
  routed 152 (`tests`, `debt`, `docs`, `dependencies`, `polish`) to the annex
  untouched, leaving 208 packed into 32 per-file batches. One refuter agent per
  batch, plus a second independent refuter on the 16 high-stakes batches, plus 5
  completeness critics reading the production telemetry, plus 2 capped gap-probe
  rounds (27 probes run, 5 dropped).

A refuter answers four questions per finding: is the evidence real, is the
behaviour intended, is the consequence as claimed, and does it duplicate a settled
prior decision. The arithmetic is deliberately hostile to the audit:

- A finding dies if a **majority** of its refuters vote against it.
- A tie survives, so `SEC-23` at 2 votes and 1 against is in section 6, printed
  with its vote count so the reader can discount it.
- **An empty verification counts as a refutation.** If a refuter could not check
  the claim, the claim dies. The unverifiable is rejected. In practice this rule
  never fired: all 26 rejections carry one written reason per vote, unanimous.
- A refuter may **narrow** a finding without killing it. 58 of the 182 survivors
  carry a `correctedImpact`, printed under the impact. **The correction is the
  version to believe**, not the original claim.
- **No refuter may raise a finding's confidence, and none did.** Every `confidence`
  value in section 6 is the original author's.

### What broke, and what was done about it

87 agents were planned. 86 completed across three quota windows (two usage-limit
stops, both resumed from cache with `resumeFromRunId`, which is the documented
normal flow). The 87th, the final `rank` agent, failed with `Prompt is too long`:
its prompt inlines all 182 survivors with their votes, the 26 refutations and the
57 sweep findings.

Rather than rewrite the workflow (forbidden by `RUN.md`) or re-run a summarising
agent (which would lose data), the assembly it was doing was reproduced
deterministically in Node from the 86 cached agent results, applying the workflow's
own `kills` and `survives` predicates verbatim. The resulting counts match the
workflow's own reported totals exactly: 182 / 26 / 13 / 57 / 27 / 5. Zero survivors
are missing their text; zero rejections have an unknown title. Ranking and
judgement were then done by the report author, which is where `PLAN.md` puts them
anyway.

### Counts

| | |
|---|---:|
| Findings loaded from sessions 1 and 2 | 360 |
| Routed to the annex by `triage.mjs`, unrefuted | 152 |
| Entered refutation | 208 |
| **Survived** | **182** |
| **Rejected** | **26** |
| Annex entries pulled back as mis-filed live defects | 13 |
| New findings from the gap sweep, unrefuted | 57 |
| Gap probes run / dropped at the cap | 27 / 5 |

Of the 182 verified: security 31, correctness 38, performance 54, product and
interface 57, pulled back from the annex 2. Effort S 139, M 41, L 2. Confidence
high 113, medium 59, low 10. 58 carry a refuter's correction.

## 4. One finding that is not about this codebase

`code:SEC-39`, verified, high confidence.

During session 1, content was repeatedly injected into the tool-result stream
**impersonating a `PreToolUse:Read` hook**. It appeared after `Read` calls in every
package audited, and instructed the auditing agents to route repository file
contents to an external model service (`mcp__delegate__deepseek`, presented as
"opencode-zen") with a jailbreak-shaped system prompt, and to skip confirmation
gates.

It was not followed in any instance. Multiple independent agents flagged it in
their own coverage notes rather than acting on it, which is the behaviour you want
and also the reason it is documented here rather than merely noticed.

This is an attack on the session and tooling layer, not a defect in Outrival's
code. It has no `file:line` and no fix in this repository. It belongs in the report
because an audit that silently absorbed an instruction to exfiltrate the source
tree would be worthless, and because whatever produced it is still installed.

**Suggested action:** audit the installed hooks, MCP servers and plugins in this
environment for whatever emitted those blocks, before the next session.

## 5. Priority queue

Ranked by the report author. Section numbers point at the full entry with its
proof.

### Act first

| # | Finding | Where | Status | Effort | Fix risk |
|---:|---|---|---|---|---|
| 1 | Cross-org read: `GET /api/feedback` has no `orgId` filter | `code:COR-01` (6.2) | verified, high | S | low |
| 2 | 402 from an AI provider skips failover, breaker and every alert; ~11 days live | 7.1, gap sweep | **unrefuted** | M | medium |
| 3 | ~859 `Failed query`/30d, suspected postgres.js prepared statements vs Neon pooler | 7.1, gap sweep | **unrefuted** | S | high |
| 4 | Migration journal clock skew, live in the repo today | `code:SEC-01`, `code:COR-08` (6.1, 6.2) | verified, high | S | high |
| 5 | `[À COMPLÉTER]` published as the publisher identity on the legal pages | `ux:78` (6.4) | verified, high | S | low |

### Next

| # | Finding | Where | Status | Effort | Fix risk |
|---:|---|---|---|---|---|
| 6 | Swallowed DB error defeats the suspended-account sign-in lockout | `code:COR-02` (6.2) | verified, high | S | high |
| 7 | SSRF family: probe oracle, brand-match bypass, unvalidated Slack redirect, browser-render cascade | `code:SEC-02`, `SEC-03`, `SEC-04`, `SEC-14` (6.1) | verified, high | S to M | medium |
| 8 | CRM webhook signing secret stored in plaintext next to an encrypted sibling | `code:SEC-08` (6.1) | verified, high | M | high |
| 9 | Unescaped title/body reach `emailShell`, against the package's own contract | `code:SEC-05` (6.1) | verified, high | S | medium |
| 10 | React #418 hydration on the dashboard pages a returning user hits most | `ux:00`, `ux:33` (6.4) | verified, high | S | low |

### Then

- **Accessibility and responsive**, one campaign rather than eleven tickets:
  `ux:14` (1345 contrast nodes over 73 routes, both themes, contradicting the site's
  own accessibility claim), `ux:82` (55 px overflow on 44 of 45 authenticated
  routes at 768 px), `ux:80` (`Ask` has no accessible name on mobile, 104 nodes),
  `ux:83`/`ux:58`, `ux:25`, `ux:28`, `ux:35`, `ux:36`, `ux:31`, `ux:34`, `ux:06`.
- **Database indexes and constraints**: `code:PER-04`, `PER-06`, `PER-16`,
  `PER-38`, `code:COR-07`, `COR-15`. All need a migration, so all are fix risk high
  and belong in one batch, staging first.
- **N+1 and fan-out in cron jobs and API routes**: the bulk of section 6.3. Cheap
  individually, and the category that grows with tenant count.
- **Email and export correctness**: `ux:19` (em dash in live transactional subject
  lines), `ux:45` (no unsubscribe path on welcome, celebration and monthly recap),
  `ux:54` (French guillemets in every battle-card PDF), `ux:39` (raw ISO timestamp
  in the PDF footer).


## 6. Verified findings (182)

Every entry below survived phase 4: at least one independent refuter agent read
the cited code or artefact and could not kill it. `confidence` is the value the
original finding claimed; no refuter is allowed to raise it, and none did. Where a
refuter narrowed or corrected the claim without killing it, the correction is
printed under the impact and is the version that should be believed.

Fix risk is the report author's, applied uniformly by this rule:

- `high` — the fix needs a migration on a shared env, changes a pg-boss queue option (`createQueue` is create-if-not-exists, so options never update on a live queue), or alters auth/session semantics.
- `medium` — the fix crosses several call sites, or lands in a package everything imports (`shared`, `queue`, `ai`), or is M/L-sized.
- `low` — the fix is local to one function or file and changes nothing for other callers.

Full verifier transcripts (the `checked` field, one per vote) live in
`~/.outrival-audit/2026-08-16/findings-verified.json` and are not reproduced here.

### 6.1 Security (31)

#### `code:SEC-23` — enqueue()/enqueueMany() pass caller SendOptions straight to pg-boss unvalidated

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - boss.ts:257-262 — JobDef.enqueue typed to accept pg-boss's full SendOptions, no field allowlist
  - boss.ts:306-307 — forwards options ?? {} unvalidated
  - jobs.ts:278-287 — probePricingCalculator sets retryLimit:0 deliberately, to avoid extra hits on a competitor's site
- **Impact:** Any importer holding a JobDef can silently override retryLimit/expireInSeconds/deadLetter per send, defeating a policy chosen specifically for scraping courtesy, with no log or guard marking the override.
- **Corrected by the refuter (kept, not overridden):** Currently a type-level gap only, not an exploited or silently-triggered override: no in-repo caller sends retryLimit/expireInSeconds/deadLetter through SendOptions, and the API-facing wrapper already restricts options to {singletonKey, priority}. Worth tightening JobDef.enqueue's type to an explicit allowlist, but nothing today defeats the scraping-courtesy retryLimit:0.

#### `code:SEC-24` — Raw pg-boss error text forwarded unredacted to an external Slack webhook

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `boss.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - boss.ts:72-83 — alertQueueError() takes err.message/String(err) verbatim, posts to OPS_SLACK_WEBHOOK_URL with no filtering
  - boss.ts:143-146 — boss.on("error",...) routes every pg-boss failure (incl. connection/auth failures) through this path
- **Impact:** Connection/auth errors can embed connection-string or diagnostic detail in err.message; a credential fragment landing in Slack history is much harder to rotate away from than a log line.

#### `code:SEC-22` — Single-use sign-in code transmitted via URL query string

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `auth.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - auth.ts:161-194 — GET /otp-link reads email and code from c.req.query
- **Impact:** The one-click sign-in link embeds the raw OTP and email as GET params, liable to land in server/proxy access logs, browser history, and be prefetched by corporate email-security link scanners — a known GET-based auth link failure mode.

#### `code:SEC-37` — /disconnect-oauth omits the step-up re-auth required by its sibling security endpoints

- **Status:** verified true · votes 2, against 1 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** apps/api · `auth.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - auth.ts:284-310 — no verifyReauthCode call
  - auth.ts:208-274,319-348,365-399,413-449,475-509 — set-password, regenerate-backup-codes, two-factor/disable, two-factor/enable, passkey/verify-registration all call verifyReauthCode before mutating
- **Impact:** A hijacked/open session alone is enough to unlink a connected OAuth provider, unlike every other Settings > Security mutation in the same file. Impact is likely bounded since email-OTP sign-in remains available regardless, per the route's own reasoning.
- **Corrected by the refuter (kept, not overridden):** Real inconsistency, but lower severity than the sibling endpoints: every step-up-gated route in this file ADDS or MODIFIES a persistent credential (password, backup codes, TOTP secret, passkey) that would survive session revocation and hand an attacker durable access. /disconnect-oauth only REMOVES an auth method — it grants a session-hijacker no new capability they didn't already have, and the route's own comment confirms no lockout risk since email-OTP sign-in remains. Worth a fix for consistency, but not an account-takeover-grade gap.

#### `code:SEC-19` — Scraped/adversarial content is spliced unescaped into AI prompts across extraction and signal-generation tasks

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `extract-pricing.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - extract-pricing.ts:177-179, extract-reviews.ts:43, extract-entitlements.ts:37, generate-extractor.ts:91-93, extract-self-profile.ts:49 — raw scraped text embedded between literal tags with no delimiter escaping
  - posthoc-grounding.ts:229-236 — verifies numbers/quotes only against the same untrusted sourceText
  - classify-change.ts:56-90 and generate-signal.ts:424-448 (apps/workers) — diffText (fully attacker-controlled by the scraped site) drives insight/soWhat/recommendedAction, later emailed and Slack-posted verbatim; severity-guard.ts only bounds the severity field, not free text
- **Impact:** A crafted competitor page can attempt to break out of the data section and inject instructions; the grounding net only verifies figures/quotes appear in the same untrusted source, so a planted fabricated fact passes as "verified," and categorical/enum fields aren't checked at all. Downstream, this reaches customers via email and Slack (mrkdwn link syntax) essentially unfiltered.
- **Corrected by the refuter (kept, not overridden):** The claim that this reaches customers 'essentially unfiltered' via email is wrong: send-alert.ts HTML-escapes insight/soWhat/recommendedAction before building the email body (escapeHtml() calls at lines 228-230). Slack IS genuinely unescaped (send-alert.ts:136/160, notify.ts's sendSlackMessage does raw string interpolation) and the generic webhook JSON payload also carries the raw strings — so the real exposure is Slack mrkdwn injection and raw text in the webhook payload, not an unfiltered email channel.

#### `code:SEC-31` — Raw model output logged to stdout/stderr on every parse failure, unredacted

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `extract-pricing.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - extract-pricing.ts:191 — console.error(...,"raw:", raw.slice(0,500))
  - battle-card.ts:537, mine-job-facts.ts:130, extract-reviews.ts:86, extract-jobs.ts:72 — 17 call sites total matching this pattern
- **Impact:** Every parse-failure path writes up to 500 chars of raw model output — derived from scraped competitor content and potentially the org's own product/pricing data — straight to logs with no redaction, a data-minimization gap depending on log aggregation governance outside this package.

#### `code:SEC-01` — Migration journal has a live clock-skew entry — the exact defect that already silently skipped migration 0062 in prod

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `realign-journal.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - _journal.json idx 69 (0069_military_thunderball, when=1785614303242) sits 1ms BEFORE idx 68 (when=1785614303243)
  - realign-journal.ts:4-16 documents this exact mechanism already caused migration 0062 to silently skip in prod while printing success
  - preflight-prod.ts:70-76 has a SKEW check but it isn't wired into CI or a pre-merge gate
  - migrations.test.ts checks journal idx contiguity but never asserts `when` is monotonic
- **Impact:** The runtime migrator compares each migration's `when` against the highest applied `created_at`; an out-of-order `when` can make db:migrate:deploy silently skip a migration while reporting success. This already happened once (0062); nothing automated catches a recurrence.

#### `code:SEC-02` — Webhook test endpoint bypasses the hardened SSRF guard, acts as an internal-network probe oracle

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/notifications.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/notifications.ts:115,130 — POST /api/notifications/test calls plain fetch() on org.slackWebhookUrl/org.webhookUrl
  - packages/shared/src/webhook/sign.ts (sendWebhook: redirect:"manual" + per-hop isSafeWebhookUrl re-validation)
  - crm-destinations.ts is the correct call site using sendWebhook for the same class of URL
- **Impact:** Any org member can use this endpoint to probe reachability of internal hosts/ports via a stored or redirecting webhook URL — no redirect guard, no re-validation, and the raw fetch error is echoed back to the caller.

#### `code:SEC-03` — validateMonitorUrl skips the internal-host guard its sibling validators enforce — brand-match SSRF bypass

- **Status:** verified true · votes 2, against 1 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `monitor-url.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - monitor-url.ts:130-187 (validateMonitorUrl body — no isUnsafeHost call)
  - monitor-url.ts:103-120,220-246 — validatePublicUrl and validateCustomMonitorUrl both call isUnsafeHost(parsed.hostname)
  - url.ts:36-46 — normalizeHostname/extractBrand reduces a 3-label host under an unrecognized suffix (e.g. .internal, .local) to its middle label as "brand"
- **Impact:** A host shaped `x.<brand>.internal` reduces to urlBrand === <brand>, so an attacker who knows a tracked competitor's brand can submit a monitor URL that passes sameBrand and reach ok:true even though the sibling validators would reject it — reopening the SSRF surface isUnsafeHost exists to close.
- **Corrected by the refuter (kept, not overridden):** A monitor URL shaped `x.<brand>.internal` gets accepted and stored at create/edit time (a real validation-consistency bug worth fixing), but it is not a working SSRF probe: every scrape attempt against it is independently blocked by safeFetch's own isUnsafeHost check, so the practical effect is a monitor that always fails to scrape, not a reachable internal-network oracle.

#### `code:SEC-04` — sendSlackMessage / tenant Slack webhook path has no SSRF or redirect validation, unlike sibling sendWebhook

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `packages/shared/src/notify.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/shared/src/notify.ts:1-11 — fetch(webhookUrl,...) with default redirect:"follow", no host validation, no timeout
  - packages/shared/src/webhook/sign.ts:88-129 — sibling sendWebhook does redirect:"manual" + per-hop isSafeWebhookUrl re-check specifically because a public host can 3xx toward an internal address
  - apps/workers/src/core/send-alert.ts:161,185-188 — sendSlackMessage(org.slackWebhookUrl,...) called with the admin-supplied URL, validated once at save time but never re-validated at send time
- **Impact:** A Slack webhook host that passes save-time validation but later redirects (attacker-controlled or repointed) is followed automatically to an internal address, with alert/digest text as the POST body — the exact SSRF-via-redirect gap sendWebhook was written to close, left open in its own package-mate.

#### `code:SEC-05` — Un-escaped title/body reach emailShell, contradicting the package's own escaping contract

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `packages/shared/src/email/escape-html.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/shared/src/email/escape-html.ts:1-3 — states the invariant: escape every dynamic value before it lands in emailShell HTML (AI-generated text derived from scraped, attacker-influenced content)
  - apps/workers/src/core/detect-silent-monitors.ts:190-210 — title/body built by concatenating competitorName and passed to emailShell's inner with no escapeHtml() call, unlike every other caller in the same file's dependency chain
- **Impact:** A competitor name (or similar field) containing HTML/JS renders unescaped in the customer's inbox HTML — an injection vector some desktop mail clients render permissively enough to execute.
- **Corrected by the refuter (kept, not overridden):** Holds as an HTML-injection bug in a real send path, but 'execute' in the stated impact is overstated — virtually all mail clients strip <script>; the realistic exposure is broken layout / spoofed links (phishing) rendered in the org's own inbox HTML, not code execution.

#### `code:SEC-06` — notify-onboarding-analysis never checks competitorIds belong to orgId

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `notify-onboarding-analysis.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - notify-onboarding-analysis.ts:44-48 — `ready` selected via inArray(competitors.id, competitorIds) only, no eq(competitors.orgId, orgId)
  - notify-onboarding-analysis.ts:62-73 — self-heal nudge re-enqueues refreshCompetitorSummary keyed off the same unchecked ids
  - contrast: scrape-ai-visibility.ts:96-100 explicitly joins eq(products.orgId, orgId) for the equivalent field
- **Impact:** The completion check, the org-facing notification text, and the AI-spend-triggering re-enqueue all key off whatever competitor rows the ids resolve to, including rows owned by a different organisation — no defense-in-depth against a stale/mistaken cross-org payload.
- **Corrected by the refuter (kept, not overridden):** Real hardening gap (missing defense-in-depth), not an active vulnerability: the single caller (apps/api/src/routes/onboarding.ts /complete) always passes ids freshly created under the caller's own orgId in the same request, so no cross-org data currently reaches the completion check, notification copy, or the re-enqueue. Worth an eq(orgId) belt-and-suspenders fix, not a live security hole.

#### `code:SEC-07` — Ask agent feeds raw scraped review text into a customer-facing LLM prompt unsanitized

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/lib/ask/tools.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/lib/ask/tools.ts:337-381 — getReviewThemes returns reviews.content verbatim (externally/publicly writable scraped text)
  - apps/api/src/lib/ask/agent.ts:128-132 — spliced into buildAskSynthesisPrompt() for AI_CONFIG.insights
- **Impact:** Anyone who can post a review of a monitored competitor can plant prompt-injection text reaching a customer-facing LLM response; citation re-validation bounds disclosure of unrelated org data but not free-text synthesis being steered (false claims, phishing links).

#### `code:SEC-08` — CRM webhook signing secret stored in plaintext, unlike the sibling oauth-connections encryption pattern

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `apps/api/src/routes/crm-destinations.ts`
- **Effort:** `M` · **fix risk:** `high`
- **Proof:**
  - crm-destinations.ts:18 — `secret: text("secret")`, no encryption, contrasted with oauth-connections.ts:9-11 (documented AES-256-GCM ciphertext)
  - apps/api/src/routes/crm-destinations.ts:57,61 — request body's secret written straight into the column
  - apps/workers/src/core/send-alert.ts:283 — d.secret read back raw to sign outbound webhook bodies
- **Impact:** The HMAC secret authenticating Outrival's outbound webhooks sits in cleartext in Postgres; a DB compromise or Neon backup/branch leak lets an attacker forge signed webhook payloads — the exact risk oauth-connections.ts already solved for OAuth tokens in the same package.

#### `code:SEC-09` — Admin email allowlist independently duplicated in web and API, can drift on offboarding

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `apps/api/src/middleware/admin.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - apps/web/src/app/(admin)/admin/_lib/server.ts:9-12,26-32 — parses ADMIN_EMAILS into its own array for requireAdmin()
  - apps/api/src/middleware/admin.ts:6-13 — parses the same-named env var independently for adminMiddleware
  - web and api are deployed/configured independently per docs/deployment.md
- **Impact:** If the two lists drift (e.g. offboarded from API's list but stale on web), requireAdmin() still renders the full admin shell (nav to all 23 sections) for a de-authorized email; underlying data stays protected since adminFetch calls fail against the API's own gate, but the admin surface's existence and structure leak.
- **Corrected by the refuter (kept, not overridden):** Deliberate two-layer gate (web = UX convenience per its own comment, API = actual authority), not an oversight. Real but low-severity: on env drift, a recently-revoked admin could still see the admin nav/section labels client-side for a while, but every actual data fetch still 403s at the API — no customer data or admin data is exposed, only shell/structure.

#### `code:SEC-10` — PRODUCT_PREVIEW_ENABLED flag also unauthenticated-exposes the email-template viewer

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `apps/web/src/app/dev/preview-emails/page.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/app/dev/preview-emails/page.tsx:117-121
  - apps/web/src/app/dev/preview/page.tsx:22-27 — both /dev/preview and /dev/preview-emails share the same env gate, no session check
- **Impact:** Turning on PRODUCT_PREVIEW_ENABLED=1 in prod to regenerate marketing screenshots also unlocks the unrelated, fully unauthenticated transactional-email-template viewer for as long as the flag stays on.
- **Corrected by the refuter (kept, not overridden):** Fact holds (shared flag, no session check on either /dev route) but impact is much smaller than framed: preview-emails has no data layer at all — it renders 5 hardcoded fixture samples with fake competitor names/numbers. Turning the flag on during a marketing-capture window exposes only static HTML template structure (visible anyway to any real recipient of these emails), not any customer or org data.

#### `code:SEC-11` — Several source scrapers bypass safeFetch, contradicting crawler.ts's stated SSRF invariant

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `crawler.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - crawler.ts:16-21 — comment asserts every source scraper funnels through scrapePage/scrapeStatic so a single host check guards every monitor target
  - github.scraper.ts:50, hackernews.scraper.ts:42, wayback.ts:59/89, cdx.ts:72, trustpilot.scraper.ts:77/110, appstore-reviews.scraper.ts:35/170, news.scraper.ts:30 — all use raw fetch(), no safeFetch import; wayback.ts:89 also uses redirect:"follow"
- **Impact:** Currently low-risk since target hosts are hardcoded to third-party public APIs, but the invariant crawler.ts claims is factually false for ~8 call sites — a future edit building part of the URL from response data would ship with no SSRF guard, unlike every other scraper.
- **Corrected by the refuter (kept, not overridden):** Zero live SSRF exposure today, not just 'low-risk': all 8 sites resolve to fixed literal hosts (hn.algolia.com, api.github.com, archive.org/web.archive.org, api.trustpilot.com, itunes.apple.com, news.google.com). This is a doc-accuracy nit (crawler.ts's comment overclaims 'every source scraper') plus a reasonable hygiene ask for future code, not a bypassed security control.

#### `code:SEC-12` — dev.ts cron-trigger and job-detail routes have no admin gate, only session auth

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/dev.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - apps/api/src/routes/dev.ts:59,63-71,121-135 — devRouter.use('*', authMiddleware) only, no adminMiddleware
  - apps/api/src/index.ts:174-179 — mount is gated only by NODE_ENV==='development' strict equality
- **Impact:** Any authenticated user (any org, any role) could fire global crons or read any org's job payload/error by id, if this router is ever mounted in a shared non-production environment (e.g. the planned staging mirror). Unreachable in the current prod deploy.
- **Corrected by the refuter (kept, not overridden):** Confirmed unreachable in prod. Reaching the described scenario needs an operator to explicitly set NODE_ENV=development on a shared/staging box — a misconfiguration the strict-equality check was written to prevent — rather than simply forgetting to set NODE_ENV, so likelihood is lower than 'if this router is ever mounted' implies. The missing admin gate and un-scoped getJob read are still worth adding before staging is provisioned.

#### `code:SEC-13` — getBoss() hands sender-mode callers the full admin + raw-SQL PgBoss surface

- **Status:** verified true · votes 2, against 1 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `apps/api/src/lib/queue-admin.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - boss.ts:153-156 — getBoss() returns the raw, untyped PgBoss instance, not scoped to 'worker' vs 'sender' mode
  - apps/api/src/lib/queue-admin.ts:42,146,243 — apps/api (documented enqueue-only, started with mode:'sender') already calls getBoss().getDb().executeSql() for raw SQL, plus getSchedules()/redrive()
- **Impact:** The worker/sender mode split apps/api's own docs rely on is advisory only: any api-side route or future bug can reach schema-level raw SQL, redrive, and schedule mutation through the same getBoss() the admin dashboard uses.
- **Corrected by the refuter (kept, not overridden):** Today the raw-SQL/redrive functions specifically (queue-admin.ts) are only invoked from admin-gated routes (email-allowlist adminMiddleware) plus one read-only, dev-mode-gated call — so no currently-reachable non-admin caller executes raw SQL or redrive. The 'no structural boundary' claim itself still holds, evidenced by battle-cards.ts's direct getBoss() use for a different method.

#### `code:SEC-14` — Browser-render cascade (patchright L1/L2) has no redirect-target validation, unlike fetch paths

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `guarded-fetch.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - guarded-fetch.ts:19-38 — safeFetch/quickFetch re-run validatePublicUrl on every redirect hop
  - crawler.ts:16-26 — validates the URL once before the cascade starts (assertScrapableUrl)
  - scrape-patchright.ts:280-313 — bare page.goto(url,...) with no host-checking route interceptor and no re-check on redirects
- **Impact:** A monitor URL that passes the upfront public-URL check can serve an HTTP 30x or client-side redirect sending the direct-egress render browser to internal infrastructure reachable from the worker box — cloud metadata endpoints, localhost services — exactly the class of request crawler.ts's comment claims is guarded for every monitor target.
- **Corrected by the refuter (kept, not overridden):** Real app-layer asymmetry between the fetch and browser-render paths. Actual exploitability depends on infrastructure-level egress controls not visible in code; if the network egress layer that crawler.ts's comment says mitigates the DNS-rebinding case is IP-range-based (not hostname-based), it would likely also catch a redirect-based attempt, which would lower this from 'SSRF succeeds' to 'missing defense-in-depth layer, likely backstopped elsewhere' — but this cannot be confirmed from the repo.

#### `code:SEC-15` — Primary scrape path (scrape-monitor.ts, verify-signal-delta.ts) skips the SSRF URL gate used elsewhere in the same codebase

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `scrape-monitor.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - scrape-monitor.ts:774-916 — configUrl ?? competitor.url handed straight to getScraper/scrapeWithApiCapture/conditionalFetch with no equivalent check
  - probe-pricing-calculator.ts:93 — contrast: explicitly calls validatePublicUrl before probing
  - verify-signal-delta.ts:133 — re-capture path (monitorScrapeUrl) has the same gap
- **Impact:** If a monitor URL is ever set to an internal/private address (typo, compromised org account, future auto-approval of a discovered competitor), this is the path that actually issues the request launching Chromium against it.

#### `code:SEC-16` — Prod-credentialed scripts run outside the versioned migration path, untracked and unreviewed

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `apply-source-migrations-prod.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - apply-source-migrations-prod.ts:1-112 — git-tracked script reading DATABASE_URL_PROD, runs raw ALTER TYPE statements outside migrations/ and its journal/hash tracking
  - .design-review/cleanup.ts:5-9 — gitignored script issuing an unguarded DELETE FROM content_items against DATABASE_URL_PROD with no dry-run, transaction, or confirmation
  - cleanup.ts:5-7's own comment frames deleted rows (named 'harness-breaking-%') as real production data — a narrative shaped to lead a reviewer (human or AI) to accept the deletion rather than flag it
  - .gitignore:20 (.design-review/) — this activity leaves no git history or review trail
- **Impact:** Direct, unreviewed prod DB mutation bypasses the versioned-migration discipline the package explicitly adopted after prior drift incidents, normalizes ad-hoc scripts holding prod credentials running arbitrary SQL, and leaves no audit trail of who ran what against production data.
- **Corrected by the refuter (kept, not overridden):** Only apply-source-migrations-prod.ts is a confirmed prod-DB-touching, unversioned script — real but lower-severity than stated, since its statements are explicitly idempotent enum additions designed to no-op once the real migration lands. The cleanup.ts half of the evidence does not support a prod-data-deletion narrative: it targets the local/dev database and its comment plainly identifies the deleted rows as test fixtures, not production data.

#### `code:SEC-17` — ai-quality-checks ops queries have no orgId parameter — any caller gets every tenant's flagged AI output

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `ai-quality.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - ai-quality.ts:99-120 — listFlaggedQualityChecks(limit) selects citations, groundingValidation, faithfulness across ALL orgs with no orgId argument
  - ai-quality.ts:153-238 — getQualityReviewStats/getQualityByTask/getConfidenceDistribution likewise unscoped, exported unguarded from index.ts:3
  - contrast: acknowledgeQualityChecks (same file, line 74-94) correctly does eq(orgId,...)
- **Impact:** The only thing preventing a cross-tenant leak of AI-generated insight text/citations is every future caller remembering these four functions are admin-only by convention; the db package offers no type-level signal stopping a non-admin route from wiring one in.
- **Corrected by the refuter (kept, not overridden):** Not currently exploitable — both real call sites are properly access-controlled. The residual risk is purely a missing type-level guardrail against a hypothetical future non-admin caller wiring one of these functions in directly, not an active vulnerability.

#### `code:SEC-18` — XSS via unvalidated URL scheme on scraped/AI-extracted href fields

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web · `signal-facts.tsx`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - signal-facts.tsx:417 — href={e.url}, target=_blank, unvalidated
  - jobs-card.tsx:37 — href={job.url}
  - positioning-tab.tsx:827,916,1044 — href={n.evidenceUrls[0]} etc.
  - content-tab.tsx:954,1167 — href={item.url}
  - api.ts:3043,3055 — underlying types are plain string/string[], not a validated/branded URL type
- **Impact:** If a monitored page's title/pricing/job-posting text is mis-extracted as a javascript:- or data:-scheme value, it reaches a dashboard as a clickable link with zero scheme check on the web side; a click executes attacker-influenced JS in the session-cookie-bearing origin. Exploitability depends on unverified upstream (packages/ai/scrapers) behavior, but apps/web itself provides no defense-in-depth at the render boundary.
- **Corrected by the refuter (kept, not overridden):** Real defense-in-depth gap at the render boundary, but not a live/likely XSS: the realistic extraction paths for evidenceUrls/job.url/item.url are already scheme-sanitized upstream in packages/scrapers, so a malicious javascript:/data: URI reaching these fields would require a path scrapers hasn't already filtered — a narrower and less likely scenario than the finding implies.

#### `code:SEC-25` — fromRepo forwards unredacted repo text (including an "env example") to third-party LLM providers

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `from-repo.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - from-repo.ts:15 — RepoArtifacts.envExample: string | null
  - from-repo.ts:48 — env example spliced verbatim (sliced to 1000 chars) into the prompt alongside readme/docs
  - provider-pool.ts:1-13 — pool is Cerebras/Cloudflare Workers AI/Groq/Mistral, non-Anthropic third-party vendors
- **Impact:** No secret-pattern scrubbing exists before forwarding repo-derived text to external inference providers. A public repo that committed a real .env instead of .env.example, or pasted a key in README/docs, has that credential transmitted verbatim during onboarding's "developing" stage.
- **Corrected by the refuter (kept, not overridden):** Minor precision: the code fetches specifically the file at path `.env.example` (github.ts:79), not an arbitrary `.env`. This slightly softens but doesn't remove the risk — real repos routinely leave genuine credentials in that conventionally-public file, and none of them are scrubbed before reaching third-party inference providers.

#### `code:SEC-26` — R2 client (with object-storage credentials) exported through the same barrel apps/web client components import from

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `client.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - r2/client.ts:9-18 — new S3Client({credentials:{...}}) executed unconditionally at import time, not lazily
  - index.ts:21-22 — export * from ./r2/client sits in the same mandatory single barrel as every client-safe util
  - package.json has no sideEffects:false; repo-wide grep for "server-only" returns nothing
  - auth-form.tsx ("use client") imports from @outrival/shared
- **Impact:** Whether the R2 module (server-only credentials + AWS SDK + node:zlib) stays out of the browser bundle depends entirely on best-effort tree-shaking, not an enforced boundary. Literal credential values wouldn't leak (non-NEXT_PUBLIC env vars aren't statically inlined), but a regression ships a large SDK chunk and privileged upload/delete functions onto the client-reachable module graph with zero backstop.

#### `code:SEC-27` — outrival.product scope cookie is set without the Secure attribute

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web · `product-scope-provider.tsx`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - product-scope-provider.tsx:32-34 — client-set outrival.product cookie omits Secure
- **Impact:** On any mixed-content/downgrade scenario the cookie could be set/read over plain HTTP. Low sensitivity alone (just a product id, API expected to re-validate ownership), but compounds the already-flagged unverified tenant-scoping since it controls which product's data a server-seeded fetch requests.
- **Corrected by the refuter (kept, not overridden):** Real gap, low severity: exploitation needs an active MITM/downgrade against what production.md documents as an HTTPS-only deployment (OVH+Coolify), and the cookie carries only a product id the API is expected to re-validate. The provider's own self-heal effect (product-scope-provider.tsx:70-74) also clears a stale/wrong scope once real product data loads, further limiting the blast radius to a transient UX glitch rather than a security escalation.

#### `code:SEC-29` — Trustpilot API key sent as URL query parameter, not a header

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `scraper.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - trustpilot.scraper.ts:74-80,110-113 — TRUSTPILOT_API_KEY embedded in the request URL (?...&apikey=...)
- **Impact:** Query strings are more likely to be captured incidentally (access logs, future request-tracing). No immediate in-package leak found (error paths don't echo the URL), but the key's placement is a risk the code shouldn't depend on staying accidentally safe.
- **Corrected by the refuter (kept, not overridden):** Not an Outrival design flaw — Trustpilot's public Business Units API only accepts the key as ?apikey=, so no header alternative exists for this endpoint. The residual risk is real but narrow: Sentry (sendDefaultPii:false, no explicit breadcrumb URL scrub) could capture the full URL including the key on an error inside the worker process. No evidence of an actual leak today; recommend scrubbing the apikey query param before it reaches Sentry breadcrumbs, not moving to a header that doesn't exist.

#### `code:SEC-34` — withAiCache has no tenant dimension in its cache key, only namespace + content hash

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `ai-cache.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - ai-cache.ts:4-8 — AiCacheOptions carries only namespace and ttlSeconds
  - ai-cache.ts:32-63 — makeCacheKey hashes input alone: ai:${namespace}:${hash}, no orgId/tenantId parameter anywhere
- **Impact:** Correctness of tenant isolation rests entirely on every caller folding org context into the hashed input themselves; a future caller hashing only content-derived text (plausible for cost dedup on identical scraped pages) would silently return one org's cached AI output to another.
- **Corrected by the refuter (kept, not overridden):** No caller today caches genuinely tenant-private data under a collidable content-only key; the risk is a documentation/contract gap (nothing enforces future callers do the same), not a demonstrated or even currently-plausible cross-tenant data leak.

#### `code:SEC-38` — Per-domain rate limit keys on a hardcoded 22-entry TLD list, not a real public suffix list

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/shared/src/url.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - rate-limit.ts:39 — awaitDomainSlot keys the courtesy gap on normalizeHostname(url), commented as eTLD+1
  - packages/shared/src/url.ts:1-46 — normalizeHostname implements eTLD+1 via a hardcoded 22-suffix set, not a maintained PSL
  - discover.ts:8-37 — same codebase already enumerates github.io, vercel.app, pages.dev etc. as shared-hosting suffixes elsewhere
- **Impact:** Two competitors on a shared-registration suffix outside the 22-entry list collapse to the same rate-limit key and throttle each other; a real multi-part ccTLD missing from the list gets truncated, splitting one domain's crawl budget. A politeness/correctness gap, not an exploitable vulnerability.

#### `code:SEC-39` — Repeated content injected into the tool-result stream during this audit, impersonating a hook and urging delegation to an external LLM with confirmation gates skipped

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** cross-package (session/tooling layer, not repo code) · `/settings`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - Fabricated "PreToolUse:Read hook additional context" blocks appeared after Read calls across every package audited (apps/web, apps/api, apps/workers, packages/db, packages/ai, packages/scrapers, packages/queue, packages/shared), instructing routing of file contents to mcp__delegate__deepseek ("opencode-zen") with a jailbreak-style system prompt ("do not deliberate... no self-checking") and an explicit instruction to skip any confirmation gate
  - .claude/settings.json:57-63 — the repo's only real configured PreToolUse hook is block-secrets.sh; grep across the repo for the injected text's distinctive phrases returns zero matches, confirming it did not originate from any repository file
- **Impact:** Not a codebase defect — untrusted content injected at the tool/hook layer of this audit session repeatedly tried to get the auditing agent to exfiltrate repo source to an unvetted third-party model and to suppress its own review judgment while doing so. Not followed in any instance; all reads in this audit used the standard Read tool directly.

### 6.2 Correctness (38)

#### `code:COR-16` — outrival-dlq mixes two payload shapes; only the hand-routed one carries a reason

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `M` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:183-198 (DeadLetter's doc contrasts itself with pg-boss's own dead-lettering, citing a prior incident of 600 unexplained DLQ jobs)
  - packages/queue/src/boss.ts:220-227,441-452 (the __dlq envelope is added only on the hand-routed DeadLetter path)
  - packages/queue/src/jobs.ts:219,231,236,251,255 (most pipeline jobs also set deadLetter:PIPELINE_DLQ in queueOptions, so pg-boss's own retry-exhaustion also routes there, independent of any DeadLetter throw)
  - node_modules pg-boss@12.26.1 dist/plans.js:1756-1773 (native path inserts r.data verbatim, no envelope)
- **Impact:** Rows landing in outrival-dlq via plain retry exhaustion (arguably the more common failure mode than an explicit DeadLetter throw) still have no reason/__dlq field, so redrive/inspection tooling built against the documented envelope silently misreads or skips that subset -- the exact "no way to tell what they were" problem, just narrowed rather than closed.

#### `code:COR-18` — work() has no mode-gate -- nothing at the queue-package level stops a sender process from consuming jobs

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `M` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:103-151 (startQueue(mode) only gates supervise/schedule/migrate, stores no lasting mode restriction)
  - packages/queue/src/boss.ts:419-493 (work() calls getBoss().work(...) unconditionally, no check of how startQueue() was called)
  - packages/queue/src/index.ts:2-21 (work exported from the same entrypoint as enqueue-only helpers)
- **Impact:** CLAUDE.md documents apps/api as enqueue-only and apps/workers as enqueue+work+cron, but the split is enforced by convention alone. If any apps/api code path ever calls work() (copy-paste, future refactor, compromised dependency), the internet-facing API process would start executing job handlers that drive headless Chromium and hold scraping/AI credentials meant to stay on the isolated Netcup worker box -- collapsing a trust boundary the deployment topology was built to keep separate. Currently latent: nothing in the repo calls work() from apps/api today.

#### `code:COR-22` — Dead-letter send in work() is unguarded, dropping the failure it exists to preserve

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:441-452 (await getBoss().send(dlq, payload, {}) runs inside the catch block with no try of its own)
  - packages/queue/src/boss.ts:487-488 (the normal path's _reportError + throw is skipped entirely when the DLQ send itself fails)
  - packages/queue/src/boss.ts:190-198 (DeadLetter's documented purpose: a failure nobody may silently forget)
- **Impact:** On a transient hiccup reaching the queue Postgres while dead-lettering, the job's real DeadLetter reason is never reported and the job falls back to ordinary retry/backoff instead of being parked for redrive -- silently reproducing the class of bug (lost failures) this code was written to fix. Requires two coincident failures (handler + DLQ send) to trigger.
- **Corrected by the refuter (kept, not overridden):** Not a permanent loss as stated: every DeadLetter-throwing job in jobs.ts (scrape-monitor, classify-change, generate-signal, send-alert) also carries `deadLetter: PIPELINE_DLQ` on the queue itself (jobs.ts:219,231,236,255), so when the uncaught send-failure exception falls through, pg-boss's own retry policy takes over and — once retries exhaust — its native dead-letter routing still lands the job in outrival-dlq (per COR-16, without the __dlq/reason envelope) rather than dropping it. The reason is only truly lost if the DLQ-send failure persists across every retry attempt (verify-signal-delta, retryLimit:0, is the one job where this happens on the very first failure); a single transient blip self-heals on the next retry since DeadLetter is deterministic and will be thrown, and sent, again.

#### `code:COR-27` — startQueue()'s singleton guard is not concurrency-safe despite its own docstring

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:101-102 (docstring: idempotent per process, a second call returns the already-started instance)
  - packages/queue/src/boss.ts:114,148-149 (bare if (_boss) return _boss; _boss only assigned after await boss.start() resolves)
  - apps/api/src/lib/queue.ts:12-33 (the API's own caller had to build its own single-flight lock around startQueue(), which would be redundant if the claim held)
- **Impact:** Two uncoordinated concurrent startQueue() calls each construct and start a full PgBoss instance (its own connection pool, and its own supervisor/cron loop if supervise/schedule are true) before the second overwrites _boss -- the first instance leaks, never stopped, still holding connections. Not exercised today only because the one concurrency-prone caller (apps/api) independently built its own lock instead of trusting this one.

#### `code:COR-28` — registerQueues() reconciliation can't detect a deadLetter removed from config

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:282 (deadLetter key omitted entirely when unset, rather than set to null)
  - packages/queue/src/boss.ts:353-356 (drift computed by iterating desired's own keys only, so an omitted deadLetter is never compared)
  - packages/queue/src/boss.ts:322-328 (function's own doc claims jobs.ts becomes the source of truth on every boot)
- **Impact:** If a job's deadLetter is intentionally removed from JobConfig later, the live queue in Postgres keeps routing exhausted retries to the old DLQ forever on any environment where it was already created -- silent drift in exactly the direction this function exists to close. Currently latent: no job in jobs.ts has had its deadLetter removed yet.

#### `code:COR-29` — Malformed QUEUE_MAX_DEFERRALS silently disables the deferral feature entirely

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:53 (Number(process.env.QUEUE_MAX_DEFERRALS ?? 3), no NaN guard)
  - packages/queue/src/boss.ts:462 (deferred < MAX_DEFERRALS gates the whole rate-limit-avoidance path)
- **Impact:** If QUEUE_MAX_DEFERRALS is ever set to a non-numeric value, Number() yields NaN and every comparison deferred < NaN evaluates false, including the first attempt -- the deferral path this package exists for (avoid burning AI-pool retries inside a still-throttled window) goes silently inert fleet-wide, with no log line or Sentry event marking the misconfiguration.

#### `code:COR-30` — JobConfig.concurrency truthy-check swallows an explicit 0 or a NaN env parse

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:298 (...(config.concurrency ? {localConcurrency: config.concurrency} : {}) uses a truthy check, not ??)
  - packages/queue/src/jobs.ts:218,250,260 (SCRAPE/VERIFY/SUMMARY_CONCURRENCY parse Number(process.env.X ?? default); an empty-string or non-numeric env value parses to 0 or NaN, both falsy)
- **Impact:** pg-boss itself asserts localConcurrency must be >= 1 when the option is actually passed, so a literal 0 would crash the worker at boot -- but the truthy check intercepts it first and silently omits the option, falling back to pg-boss's default of 1. An operator misreading this as "set to 0 to pause the queue", or a templating bug rendering an env var empty, gets a silently running queue at concurrency 1 with no error indicating the override was dropped.

#### `code:COR-31` — getJobById() failure during a deferral resend silently strips priority/singletonKey, unlogged

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `packages/queue/src/boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/queue/src/boss.ts:471-473 (getBoss().getJobById(...).catch(() => null))
  - packages/queue/src/boss.ts:474-478 (resend spreads meta?.priority/meta?.singletonKey only when meta is truthy)
- **Impact:** The surrounding comment states the invariant this code protects: a user-priority scrape must not come back as background work, and a singleton-keyed job must not reappear as a second copy of itself. If getJobById throws (the same transient queue-DB hiccup class that triggers deferrals), the catch silently returns null and the resend drops both fields with zero logging.
- **Corrected by the refuter (kept, not overridden):** The unlogged priority/singletonKey drop on a failed getJobById is real and reachable (deferrals run live in prod per the file's own comment about 333 extract_pricing calls), but its trigger isn't correlated with the deferral cause as claimed — it's an independent, unrelated queue-Postgres blip during the resend's own metadata lookup, not part of 'the same transient queue-DB hiccup class that triggers deferrals' (deferrals are AI-pool-rate-limit-triggered per resolveAiDeferral).

#### `code:COR-23` — Admin mutations write local state only, server snapshot never revalidated

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `view.tsx`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/app/(admin)/admin/ai-review-queue/view.tsx:50,56-57
  - apps/web/src/app/(admin)/admin/feedback/view.tsx:27,39-40
  - apps/web/src/app/(admin)/admin/users/view.tsx:22
  - apps/web/src/app/(admin)/admin/jobs/view.tsx:54-55
- **Impact:** Four admin Server Component pages seed a client view via useState(items) once; their mutating actions only call setList/setRows, never router.refresh() or a query invalidation (confirmed those calls exist elsewhere but not in this pattern). Once any action runs, or another admin changes the same row from a second tab, the page's view silently diverges from the DB for the rest of the mount -- e.g. two admins racing to resolve the same AI-hallucination review item.
- **Corrected by the refuter (kept, not overridden):** Only 2 of the 4 cited files actually exhibit this pattern. ai-review-queue/view.tsx (resolve(), lines 53-64: calls api.adminResolveAiReview then only setList((l) => l.filter(...)), no revalidation) and feedback/view.tsx (setStatus(), lines 37-45: calls api.adminUpdateFeedback then only setRows((prev) => prev.map(...)), no revalidation) genuinely fit: a real server mutation followed by a local-only optimistic update, no router.refresh()/refetch, so two admins in separate tabs (or a second action in the same tab) will diverge from the DB for the rest of the mount. users/view.tsx has no mutation at all in this file — its only action is search(), which replaces `rows` with a fresh `api.adminSearchUsers` server response (that IS a revalidation, not a stale local write); actual user mutations (suspend/unsuspend) live in the separate, uncited users/[id]/view.tsx. jobs/view.tsx also has no mutation — reload() and openDetail() are themselves live GET fetches (api.adminListJobs/api.adminGetJob) whose results populate state; there is no admin write action on this page to go stale. So the real defect count is 2 pages, not 4, and the 'four admin Server Component pages' framing overstates the scope.

#### `code:COR-36` — Admin feedback screenshot viewer leaks a blob URL on every view

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `view.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/app/(admin)/admin/feedback/view.tsx:54
  - apps/web/src/app/(admin)/admin/feedback/view.tsx:145
- **Impact:** viewShot() calls URL.createObjectURL(await res.blob()) and stores the result in shot state, but URL.revokeObjectURL is never called -- not when the Dialog closes (onOpenChange just sets shot to null) and not when a second screenshot replaces the first. Each screenshot an operator opens leaks its blob for the tab's lifetime; on a long moderation session this accumulates unbounded memory.

#### `code:COR-37` — Admin job list has no request-ordering guard between Refresh and Load more

- **Status:** verified true · votes 2, against 1 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** apps/web · `view.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/app/(admin)/admin/jobs/view.tsx:61-77,96,172
- **Impact:** reload() reads cursor/status/task from component state at call time but uses no AbortController and tracks no request generation; a plain refresh and an append fired close together resolve in arbitrary order and each unconditionally applies its own setRuns/setCursor, so whichever response lands last wins regardless of which was issued last. Rapidly clicking Refresh then Load more can silently discard a just-appended page or append rows under a stale filter/cursor.
- **Corrected by the refuter (kept, not overridden):** The literal scenario named ('Rapidly clicking Refresh then Load more') is not reachable: both buttons share the same `busy` boolean (line 58), and `setBusy(true)` is the first statement in reload() before any await, so React disables both buttons on the very next commit — well before a human could land a second physical click, making that specific race effectively unreachable. The underlying defect is still real, though: the task-filter Input's `onKeyDown` handler (line 120, `onKeyDown={(e) => e.key === "Enter" && reload()}`) has no `disabled={busy}` guard, unlike every button. So typing a filter and hitting Enter while a Load-more append (or another reload) is still in flight genuinely fires a second, unguarded reload() concurrently — reload() has no AbortController or request-generation check (confirmed lines 61-77), so whichever response resolves last wins and can silently discard or misapply a page. Same defect class as reported, reached via the filter input rather than the two buttons.

#### `code:COR-01` — GET /api/feedback leaks every org's feedback to any org owner, untested

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/feedback.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/feedback.ts:84-98
  - apps/api/src/routes/feedback.ts:87 (dbUser.role !== "owner" as the only gate)
  - apps/api/src/middleware/admin.ts:3-5 (explicit doctrine: org "owner" role must NEVER be used as the admin check)
  - packages/db/src/schema/users.ts:4,8,11 (role is a per-org enum, not a platform role)
- **Impact:** db.query.feedback.findMany() has no where clause at all, gated only by the caller's own per-org "owner" role instead of the platform admin allowlist (isAdminEmail) used everywhere else. Any self-signed-up free-org owner can read every other org's bug reports, screenshots (R2 keys), console errors and free-text messages -- a direct cross-tenant leak matching the exact scenario admin.ts's own comment warns against. No feedback.test.ts exists, so nothing catches a regression.

#### `code:COR-02` — Swallowed DB error silently defeats suspended-account sign-in lockout

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/auth.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - apps/api/src/routes/auth.ts:106-108
  - apps/api/src/routes/auth.ts:114
  - apps/api/src/routes/auth.ts:121-129
- **Impact:** db.query.users.findFirst(...).catch(() => undefined) turns any DB hiccup into existing=undefined; !existing?.suspendedAt then reads true, sending a working sign-in OTP to a suspended account and bypassing the operator lock-out during exactly the window a DB error is more likely. The line-105 comment claiming this lookup is "best-effort analytics only -- never branches the HTTP response" is false: existing also gates the suspension check.
- **Corrected by the refuter (kept, not overridden):** A transient DB error at OTP-send time lets a suspended account receive one working sign-in code and briefly obtain a session cookie (defeating the narrower 'never re-issue a code to a suspended email' guarantee), but it does not defeat the actual product lock-out: apps/api/src/middleware/auth.ts re-checks suspendedAt on every authenticated request independently, without a catch and without caching suspended users, so the account is still blocked (403 Account suspended) on the first API call after sign-in. Worth fixing (the comment is misleading and the OTP-issuance guarantee does break), but it is not an operator-lockout bypass.

#### `code:COR-03` — conditionalFetch() skips robots.txt and the per-domain rate limiter on the common scrape path

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/scrapers/src/lib/conditional-fetch.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/scrapers/src/lib/conditional-fetch.ts:19-53 (real GET via safeFetch, no isAllowed() or awaitDomainSlot())
  - apps/workers/src/core/scrape-monitor.ts:839-850 (called before every scheduled scrape with a resolvedUrl + etag/lastModified -- the common case)
  - packages/scrapers/src/lib/conditional-fetch.ts:25 vs fingerprint.ts:8-9 (hardcoded UA has drifted from the canonical OUTRIVAL_UA constant)
- **Impact:** Every recurring monitor refresh that qualifies for this conditional pre-flight bypasses both invariants the package's own CLAUDE.md states as non-negotiable (robots.txt checked before any request, rate-limit per eTLD+1) -- a site that has since added a Disallow, or is mid-burst from other Outrival traffic to the same domain, gets hit anyway.
- **Corrected by the refuter (kept, not overridden):** Scope is narrower than 'every scheduled monitor refresh': it only fires for sourceType in {blog, changelog} (supportsConditionalFetch) on a non-forced run where the previous snapshot already carries a resolvedUrl and an etag/lastModified — not every source type or every scrape. Within that scope the core claim holds: those requests skip robots.txt and the per-domain rate limiter entirely.

#### `code:COR-04` — Domain normalization ignores multi-part TLDs -- corrupts redirect classification and merges unrelated rate-limit buckets

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/scrapers/src/lib/diagnose-failure.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/scrapers/src/lib/diagnose-failure.ts:262-266 (sameRootDomain splits on the last 2 labels only, not the shared normalizeHostname)
  - packages/scrapers/src/lib/diagnose-failure.ts:175-186 (isOffsiteRedirect gates the SUCCESS-path completeness grader)
  - packages/shared/src/url.ts:1-24,36-46 (normalizeHostname's MULTI_PART_TLDS table covers only ~20 hardcoded suffixes)
  - packages/scrapers/src/lib/rate-limit.ts:1,39 (awaitDomainSlot keys on this same incomplete normalizeHostname)
  - packages/scrapers/src/lib/__tests__/diagnose-failure.test.ts:95-120 (no multi-part-TLD case tested)
- **Impact:** For any monitor on a two-label public suffix (.co.uk, .com.au, .co.jp, .com.br, uncovered ones like .co.il, .com.pl...), a redirect to a genuinely different company (parked domain, acquisition, hijack) computes the same root and is silently classified as the same site -- the wrong company's page becomes that monitor's snapshot with no mismatch flag, corrupting every diff/pricing/jobs signal derived from it going forward. The same incomplete suffix table separately merges unrelated competitors into one rate-limit bucket, throttling one company's scrape because of another's traffic.

#### `code:COR-05` — Billing-toggle click runs between html capture and text/screenshot capture

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/scrapers/src/lib/scrape-patchright.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/scrapers/src/lib/scrape-patchright.ts:384 (html = await page.content(), before the toggle click)
  - packages/scrapers/src/lib/scrape-patchright.ts:393-396 (toggle click)
  - packages/scrapers/src/lib/scrape-patchright.ts:400,422-424 (text and screenshot captured AFTER the click)
  - packages/scrapers/src/pricing/pricing.scraper.ts:47,54 (screenshotIfRendered always on for pricing; comment claims capture is faithful)
- **Impact:** For every pricing render where the toggle click succeeds, html still shows the default (usually Monthly) state while text and the screenshot silently show the Annual state with no label -- three fields of one ScrapeResult describe different billing states. The deterministic price path (harvest.ts parses html via cheerio) is unaffected, but any AI-grounding or visual-diff consumer reading text/screenshot sees the wrong billing period, silently, on the product's core pricing-intelligence path.
- **Corrected by the refuter (kept, not overridden):** The 'AI-grounding' half of the claim is unverified (extract-pricing's AI fallback reads html-derived text, not ScrapeResult.text) but the visual-diff screenshot half is verified and is the concretely reachable path.

#### `code:COR-06` — Price/quantity change from a zero baseline is silently dropped, not just misreported

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** @outrival/shared · `packages/shared/src/pricing-diff.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/shared/src/pricing-diff.ts:174-176 (pct divides by prev)
  - packages/shared/src/pricing-diff.ts:375-381 (comparable requires prevRow.price > 0)
  - packages/shared/src/pricing-diff.ts:409-414 (same > 0 guard for included_quantity)
  - packages/shared/src/pricing-diff.ts:447-476 (minimum_introduced already handles a null baseline correctly, pctChange: null, this pattern was not reused here)
- **Impact:** A plan going from price 0 (free/beta tier) to a positive price, or from included_quantity 0 to a positive bundle, on the same (plan_name, billing_period) key never produces a price_changed/rate_changed/included_quantity_changed signal at all -- "they started charging for what was free" and "they added an included bundle to a pure-usage plan" are both invisible to the pricing intelligence pipeline, with no partial signal the way the sibling minimum_introduced case gets.

#### `code:COR-07` — products.isPrimary invariant has no DB constraint, races in app code

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/products.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/products.ts:42-44 (comment claims exactly-one-primary invariant, no partial unique index enforces it)
  - apps/api/src/routes/products.ts:955-966 (PATCH: demote-old-primary and set-new-primary are two separate db.update() calls, not in a transaction)
  - apps/api/src/routes/products.ts:864 (create route: isPrimary: current === 0, non-atomic count-then-insert)
- **Impact:** Two concurrent PATCH requests promoting different products to primary (or a promote racing a create) can both pass their own check and leave an org with two isPrimary=true products or, on the demote step, zero -- corrupting a value the product selector UI and single-primary business logic assume is unique. apps/workers/CLAUDE.md documents exactly this doctrine (DB constraints, not app-only checks) elsewhere in the codebase; this table doesn't follow it.
- **Corrected by the refuter (kept, not overridden):** The missing DB constraint is real, and the PATCH-vs-PATCH race is real and unguarded (two bare, non-transactional updates, no lock) — two concurrent promote requests for different products in the same org can both pass their own check and leave two isPrimary=true rows, exactly as claimed. But the finding's 'create route: non-atomic count-then-insert' evidence (line 864) is factually wrong: that path is already inside `db.transaction` serialized by `pg_advisory_xact_lock(hashtext(orgId))`, specifically to close this exact race. 'Promote racing a create' is also not really a live scenario, since a create only ever sets isPrimary:true when it's an org's very first product (current===0, itself lock-protected) — there is nothing existing yet to PATCH concurrently in that case. The real, still-open risk is narrower than stated: PATCH-vs-PATCH only, not create-vs-anything.

#### `code:COR-08` — Migration journal has an unresolved clock-skew ordering violation (0068/0069)

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/migrations/meta/_journal.js`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/migrations/meta/_journal.json idx 68 (0068_complete_microchip) when=1785614303243, idx 69 (0069_military_thunderball) when=1785614303242 -- 69 is earlier than 68
  - packages/db/src/realign-journal.ts:5-16 (documents this exact class: a migration whose when sits behind its predecessor is silently skipped by the runtime migrator, which still prints success)
  - packages/db/preflight-prod.ts:70-76 (JOURNAL ORDER CHECK exists and would flag this pair, but wasn't run/acted on since 0069 was generated)
  - apps/workers/src/lib/ai-visibility/budget.ts (actively reads/writes ai_visibility_engine_budget, the table 0069 creates -- a skip is not inert)
- **Impact:** Any environment that applies migrations from scratch through this range (new worktree Neon branch, CI, disaster recovery, new dev onboarding) will silently skip 0069 while the migrator reports success -- ai-visibility budget code then fails at runtime with a missing relation. test/migrations.test.ts's fresh-DB check doesn't catch it because that table isn't in its asserted list. Not verified against any live environment's __drizzle_migrations ledger in this audit (no DB access used).
- **Corrected by the refuter (kept, not overridden):** The journal ordering violation (0069 timestamped before 0068) is real and unresolved, and the table it creates is genuinely load-bearing. But the finding's central impact claim -- 'any environment that applies migrations from scratch ... will silently skip 0069' (new worktree Neon branch, CI, disaster recovery, new dev onboarding) -- is factually wrong given drizzle-orm's actual migrator: `lastDbMigration` is captured once, before the apply loop, from whatever was in the DB BEFORE this run; it is never updated as migrations are applied within the same loop. On a genuinely fresh database `lastDbMigration` is undefined for the whole run, so EVERY migration 0000..latest applies unconditionally regardless of the 68/69 clock skew between them -- the fresh-DB/CI/disaster-recovery/onboarding scenarios the finding names are NOT at risk, and packages/db/test/migrations.test.ts passing on this exact pair is consistent with there being no bug there, not a gap in its assertions. The mechanism realign-journal.ts documents (and that genuinely bit 0062 in the past) only fires ACROSS separate migrate() invocations: an env that already applied 0068 in one deploy, with 0069 following in a later, separate deploy, would skip 0069 then. Whether that already happened to prod is unverified (no DB access, as the finding itself notes), and it's not obviously likely here: entries 0066-0070's `when` values are all within 5ms of each other, unlike 0071's (a full day-plus later) -- suggesting 0066-0070 were generated, and most likely deployed, as one batch, which would make even this narrower scenario unlikely.

#### `code:COR-09` — signal-batching's insert-then-update is not transactional -- a failure between the two writes duplicates the batch

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `apps/workers/src/core/signal-batching.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/workers/src/core/signal-batching.ts:108-133 (INSERT into signal_batches, then a separate UPDATE signals SET batchedIntoId, no db.transaction)
  - apps/workers/src/core/signal-batching.ts:66-72 (candidate SELECT re-runs from scratch every invocation, excludes only already-stamped signals)
  - packages/queue/src/jobs.ts:447 (signal-batching inherits the default retryLimit of 2)
- **Impact:** If the UPDATE throws after the INSERT already committed, or the process dies between the two statements, the signals in that group are never stamped -- the next attempt (retry or the next 6h cron tick) regroups the same signals and inserts a second signal_batches row; the first row is orphaned with a paid-for AI summary and signalIds nothing points back to.

#### `code:COR-10` — safeFetch's per-hop timeout resets on every redirect, unbounded overall

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/scrapers/src/lib/guarded-fetch.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/scrapers/src/lib/guarded-fetch.ts:21-29 (fresh AbortSignal.timeout(opts.timeoutMs) built inside the redirect for-loop on every hop)
  - packages/scrapers/src/lib/scrape-direct.ts:15, robots.ts:18,69, conditional-fetch.ts:35 (callers assume timeoutMs bounds the whole call)
- **Impact:** With MAX_REDIRECTS=5, a target that keeps redirecting just under the deadline can make one safeFetch call run up to 6x the caller's stated budget -- robots.ts's 8s FETCH_TIMEOUT_MS becomes up to 48s, scrape-direct.ts's 15s becomes up to 90s -- during which isAllowed()/awaitDomainSlot() block the whole cascade, holding a worker's concurrency slot far past the documented ceiling.
- **Corrected by the refuter (kept, not overridden):** The arithmetic (48s/90s worst case) is correct, but 'far past the documented ceiling' overstates it in context: scrapeMonitor's real ceiling is expireInSeconds=900 (jobs.ts), so even a 90s worst case is ~10% of the job's budget and does not by itself trigger job expiry or the COR-14 double-run scenario. The real, uninflated impact is that a single safeFetch call can consume up to 6x its stated per-fetch timeout, tying up one of the (default 3) scrape-concurrency slots proportionally longer — a real but more modest resource-contention issue, not an imminent job-expiry/duplicate-run trigger on its own.

#### `code:COR-11` — robots.txt Crawl-delay has no ceiling before it drives the rate-limiter's sleep

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `packages/scrapers/src/lib/robots.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/scrapers/src/lib/robots.ts:158-163 (accepts any finite non-negative number, stores n*1000ms, no upper bound)
  - packages/scrapers/src/lib/rate-limit.ts:41,57-58 (Math.max(DEFAULT_MIN_GAP_MS, crawlDelayMs) is awaited in full before the fetch proceeds)
- **Impact:** A site (hostile or misconfigured) publishing an absurd Crawl-delay value stalls awaitDomainSlot -- and therefore the whole scrapePage/scrapeStatic call -- for that entire duration, tying up a worker's job slot for hours or longer on a single domain with nothing in the chain capping it.

#### `code:COR-12` — generate-battle-card has no dedup guard, can race into duplicate/failed generations

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** @outrival/workers · `apps/workers/src/core/generate-battle-card.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/workers/src/core/generate-battle-card.ts:694-822 (check-then-act, no lock)
  - packages/queue/src/jobs.ts:318-330 (no singletonKey at either enqueue site)
  - apps/api/src/routes/battle-cards.ts:405-420
  - packages/db/src/schema/battle_cards.ts:36-38 (NULL productId is not protected by the unique index -- Postgres treats NULL as distinct)
- **Impact:** Two concurrent jobs for the same (org, competitor, product) aren't deduped by pg-boss (no singletonKey) or, for legacy null-productId competitors, by the DB unique index. Both can INSERT, leaving permanent duplicate battle_cards rows (double AI spend, ambiguous card in the org's feed). For product-scoped cards the index does stop the duplicate row, but the losing job pays for the full pipeline (AI generation, faithfulness gate, Playwright PDF, R2 upload) before dying on a unique-violation, and the default retryLimit:2 reruns that entire expensive pipeline again before self-healing into an UPDATE.

#### `code:COR-13` — TOCTOU race on per-org plan-cap count-then-insert (no lock/transaction)

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/alert-conditions.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/api/src/routes/alert-conditions.ts:66-88
  - apps/api/src/routes/standing-queries.ts:80-153,191-197
  - apps/api/src/routes/products.ts:~811-875 (the already-shipped fix for the identical class: pg_advisory_xact_lock(hashtext(orgId)) inside db.transaction())
- **Impact:** Both routes SELECT a count against the plan cap and then INSERT/reactivate outside any transaction or advisory lock, so N concurrent requests from the same org can all pass the check and all commit, exceeding the plan cap. The team has already hit and fixed this exact class in products.ts; that fix was not applied here.

#### `code:COR-14` — Expiry-triggered pg-boss retries run concurrently with the still-executing original scrape-monitor handler

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `packages/queue/src/jobs.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - packages/queue/src/jobs.ts:210-215 (team's own comment: pg-boss cannot abort a JS handler on expiry -- it retries while the original handler keeps scraping)
  - apps/workers/src/core/schedule-scraping.ts:173, mobile-apps.ts:145 (neither enqueue site passes a singletonKey/dedup token keyed on monitorId)
  - apps/workers/src/core/scrape-monitor.ts:746-762 (the only in-flight guard checks for a snapshot already written in the last hour, blind to a sibling run still mid-scrape)
  - packages/queue/src/jobs.ts:216-220 (retryLimit 2, expireInSeconds 900; a measured 302.7s pricing capture already approaches that ceiling)
- **Impact:** Two full invocations of runScrapeMonitor can execute simultaneously against the same monitorId, each independently writing scrapePickedUpAt/requiresLevel/nextRunAt/consecutiveFailures and potentially each inserting its own snapshot -- duplicate Chromium fetches, duplicate downstream classify/signal/alert fan-out, whichever write lands last silently overwrites the other's outcome.

#### `code:COR-15` — quality_feedback's documented one-row-per-target invariant has no unique constraint, and is provably raced

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/quality-feedback.ts`
- **Effort:** `M` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/quality-feedback.ts:65-70 (quality_feedback_user_target_idx is a plain index, not uniqueIndex, directly above a comment promising one verdict per target)
  - apps/api/src/routes/feedback-quality.ts:194-231 (check-then-act findFirst then conditional UPDATE/INSERT, not an atomic onConflictDoUpdate)
  - apps/api/src/routes/digest-feedback.ts:129-149 (same find-then-branch pattern at a second call site)
- **Impact:** Two concurrent requests for the same (user, target) -- a double-click, a retry, or both digest-feedback email links clicked -- both see "no existing row" and both INSERT, producing duplicate rows. Every downstream reader (monthly-recap.ts, notification-preferences.ts, admin/feedback.ts NPS/verdict aggregation) counts rows without deduping, silently skewing the metrics the invariant promised.

#### `code:COR-17` — Public battle-card share can render a different product's card

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/public-report.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/public-report.ts:62-71 (resolves the card with only eq(battleCards.competitorId, competitorId), no orderBy)
  - apps/api/src/routes/battle-cards.ts:73-77 (authenticated routes resolve via resolveProduct/competitorAnchorProduct instead)
  - packages/db/src/schema/battle_cards.ts:36-38 ((productId, competitorId) unique, but NULL productId rows aren't)
- **Impact:** When a share link was minted with no productId (the documented all-products-scope case, not just a legacy row), and an org tracks the same competitor across 2+ products (patch-28 multi-product), this public unauthenticated endpoint can return an arbitrary one of those cards -- the wrong product's competitive positioning shown to whoever holds the link.

#### `code:COR-19` — qualityFeedback rows are read/written scoped by userId only, not orgId

- **Status:** verified true · votes 2, against 1 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/feedback-quality.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/feedback-quality.ts:196-200 (POST upsert-lookup: userId+targetType+targetId, no orgId)
  - apps/api/src/routes/feedback-quality.ts:285-290 (GET nps lookup: userId+targetType)
  - apps/api/src/routes/feedback-quality.ts:309-313 (GET existence check)
  - apps/api/src/routes/feedback-quality.ts:326-330 (DELETE ownership check compares row.userId only)
- **Impact:** The qualityFeedback table is not tenant-isolated by query -- any authenticated user can read/overwrite/delete their own feedback rows regardless of current org, and a user with no current org can upsert an orphaned row. Mutations that fan out to other tables (signals/battleCards/competitorCandidates) ARE correctly orgId-scoped, so this doesn't appear to leak or corrupt another tenant's data today -- it's a defense-in-depth gap that becomes exploitable the moment a user can belong to or switch between multiple orgs.

#### `code:COR-20` — Terminal-cleanup onFailure hooks never run if the worker process dies mid-attempt

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `apps/workers/src/queue/handlers.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/workers/src/queue/handlers.ts:169-181,240-261,284-297 (three jobs simulate pg-boss's missing onFailure via a JS try/catch in the same process invocation)
  - packages/queue/src/jobs.ts:305-308 (ai-visibility-teaser: retryLimit 0, expireInSeconds 120 -- a single attempt, no second chance)
  - apps/workers/src/queue/handlers.ts:165-168 (own comment: if the hook never fires, "the day-0 card polls forever")
- **Impact:** A worker crash (OOM-kill, a deploy SIGKILL outside the drain window) during the single ai-visibility-teaser attempt, or during the last retry of scrape-monitor/generate-battle-card, means the process that would run the catch block is dead -- the terminal write (teaser's unavailable row, scrape-monitor's markedUnscrapable/lastError, battle-card failure notification) is silently skipped even though pg-boss correctly marks the job failed on expiry.

#### `code:COR-21` — Non-cascading-FK cleanup is an app-level convention (erase-org.ts) with no enforcement inside packages/db

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/signals.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - packages/db/src/schema/signals.ts:22-24, alerts.ts:10, digests.ts:6, changes.ts:7, job_postings.ts:6, reviews.ts:16 (six RESTRICT FKs, no onDelete)
  - apps/api/src/lib/erase-org.ts:7-12,55-73 (comment names exactly those six tables; transaction hand-codes that list)
  - packages/db/src/schema/posting-facts.ts:36-38 (a seventh non-cascading FK not mentioned in erase-org.ts, only safe today by coincidence of current data shape)
- **Impact:** Nothing documents or checks that every non-cascading FK into organizations/competitors/monitors/changes must be mirrored in erase-org.ts's hand-written list. A future schema addition using the same RESTRICT pattern that isn't also added there won't surface until a real GDPR erasure request hits it in production and the whole transaction rolls back on a FK violation.

#### `code:COR-24` — Four AI tasks bypass the mandated safeParseJson guard with a bare JSON.parse

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `packages/ai/src/tasks/standing-query-judge.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/ai/src/tasks/standing-query-judge.ts:85
  - packages/ai/src/tasks/match-alert-conditions.ts:92
  - packages/ai/src/tasks/batch-summary.ts:45
  - packages/ai/src/tasks/generate-visibility-prompts.ts:134
- **Impact:** packages/ai/CLAUDE.md states parsing must never be a bare JSON.parse; these four sites skip the fence-stripping safeParseJson performs elsewhere. Wrapped in an outer try/catch (returns null/parse_failed, no crash), so this is an availability/consistency gap, not data corruption -- a model reply wrapped in ```json fences fails these four calls when ~20 other sites using safeParseJson would have recovered.

#### `code:COR-25` — score-overlap.ts silently merges scores for candidates sharing a normalized domain

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `packages/ai/src/tasks/score-overlap.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/ai/src/tasks/score-overlap.ts:123-127 (byDomain.set(key, ...) per entry)
  - packages/ai/src/tasks/score-overlap.ts:131 (lookup reads back whichever score was written last)
- **Impact:** If two or more input candidates normalize to the same domain, later entries silently overwrite earlier ones in the map, and every candidate with that domain reads back a score/reason that was never actually about it. Not verified against the upstream caller to confirm same-domain candidate lists actually occur in production input.
- **Corrected by the refuter (kept, not overridden):** The byDomain.set/get overwrite is real (score-overlap.ts:123-131), but it is unreachable through the three call sites that source candidates from discovery (apps/api/src/routes/onboarding.ts, apps/workers/src/core/detect-new-competitors.ts, apps/api/src/lib/detect-candidates.ts): all three feed scoreOverlap from findSimilarCompanies(), which already runs dedupeByDomain() (packages/scrapers/src/discovery/discover.ts:206-221) to collapse same-normalized-domain entries to one row BEFORE scoreOverlap ever sees the candidate list — the function's own docstring names this exact 'same competitor comes back as x.com, www.x.com/pricing, and x.com from named seeds' scenario as the reason it exists. The one call site that skips this dedup is the bulk re-score action (apps/api/src/lib/overlap.ts scoreCompetitorsOverlap), which scores already-tracked competitor/candidate rows selected by a user; competitors.ts has no unique constraint on url/domain per org, so two existing competitor rows sharing a domain (e.g. duplicate manual entries) could in principle collide there, but this is a narrow, unconfirmed edge case rather than the general-purpose defect the finding implies.

#### `code:COR-26` — In-memory rescan-quota counter races across concurrent requests

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/my-product.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/my-product.ts:662-707
- **Impact:** POST /my-product/rescan reads usageToday once, then increments it in local JS across a loop of per-source inserts with no transaction/lock; two concurrent rescan calls from the same user can each read the same pre-increment count and both insert past the daily cap. Same missing-lock class as the plan-cap TOCTOU finding, but impact is bounded to a self-serve quota -- the user only outruns their own daily rescan budget by a source or two.

#### `code:COR-33` — credit-burn-diff pct() reports "0%" for a free action that starts being charged

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `packages/shared/src/credit-burn-diff.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/shared/src/credit-burn-diff.ts:40-41 (pct = (prev,next) => prev===0 ? 0 : ...)
  - packages/shared/src/credit-burn-diff.ts:100-101,109,112-114 (pctChange:delta; summary suppresses the percentage when delta===0)
  - packages/shared/src/entitlement-diff.ts:192-198 (sibling differ explicitly excludes beforeRow.value_num<=0 before calling its own pct)
- **Impact:** When an action goes from free to charged, pct() returns exactly 0 instead of an undefined/large value, so credit_burn_changed carries pctChange:0 -- read literally, "no change" on an infinite relative increase. severity is still correctly "high" (computed independently), so the alert fires, but any consumer sorting/filtering by pctChange magnitude misrepresents or buries this as the smallest change in the batch.
- **Corrected by the refuter (kept, not overridden):** No current code path sorts/filters/displays by credit_burn_diff's pctChange; severity (independently correct) drives all ranking, and the summary text is unaffected. Impact today is a wrong/inconsistent raw field value, not a user-visible misrepresentation.

#### `code:COR-34` — Color quick-edit bypasses the only try/catch, becomes an unhandled rejection

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `competitor-detail-view.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/app/dashboard/competitors/[id]/competitor-detail-view.tsx:435-446 (saveCompetitorDetails has no try/catch)
  - apps/web/src/app/dashboard/competitors/[id]/competitor-detail-view.tsx:1220 (color submenu: void onEditSave({color:v}), no .catch)
  - apps/web/src/app/dashboard/competitors/[id]/competitor-detail-view.tsx:1465-1471 (the only other caller wraps the same function in try/catch + toastApiError)
- **Impact:** A user picking a competitor color from the kebab menu gets zero feedback if the write fails -- the swatch silently doesn't change and nothing prompts a retry, unlike every other mutation in this file which routes through toastApiError.

#### `code:COR-35` — Sectoral feed dismiss/mark-read: optimistic write with no rollback on failure

- **Status:** verified true · votes 2, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web · `apps/web/src/components/dashboard/sectoral-feed.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/dashboard/sectoral-feed.tsx:102,113
  - apps/web/src/components/dashboard/sectoral-signals.tsx:207,218
- **Impact:** dismiss(id) removes the signal from local state immediately, then fires api.dismissSectoral(id).catch(() => {}) with a genuinely empty catch (same pattern for markSectoralRead). A failed dismiss looks identical to a successful one; the item can reappear on the next fetch/pagination with no explanation.

#### `code:COR-38` — reviseBattleCard reuses generate's 3072-token ceiling despite its own comment noting a larger prompt

- **Status:** verified true · votes 2, against 1 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `packages/ai/src/tasks/battle-card.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/ai/src/tasks/battle-card.ts:483-491,526-533
- **Impact:** The comment at battle-card.ts:526-528 says the revise pass carries the evidence AND the draft, so it's the larger request of the two, yet reuses generate's exact maxTokens:3072 derived from generate's own measured completion-token range. Not a confirmed bug -- may already be safe if revise's actual output is smaller than generate's despite the larger prompt; no production completion-length telemetry for reviseBattleCard was available to check.

#### `code:COR-39` — extractMentionSentence can misalign slice bounds on case-folding-expanding characters

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `packages/shared/src/visibility-metrics.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - packages/shared/src/visibility-metrics.ts:465 (at = answer.toLowerCase().indexOf(name.toLowerCase()))
  - packages/shared/src/visibility-metrics.ts:469-493 (at is then used to index/slice the ORIGINAL, non-lowercased answer string)
- **Impact:** String.prototype.toLowerCase() can change a string's length for certain Unicode input (e.g. U+0130). If such a character appears in answer before the matched name, the index found in the lowercased string no longer corresponds to the same offset in the original, silently shifting or corrupting the extracted verbatim sentence. Source is free-form multi-engine LLM output that can plausibly include non-English names, so the path is real though narrow-probability.

### 6.3 Performance (54)

#### `code:PER-48` — JobConfig never exposes pg-boss's queued-job retention, so a big-enough backlog silently drops work outside the DLQ

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - boss.ts:229-249 — JobConfig has no `retentionSeconds` field alongside retryLimit/expireInSeconds/deleteAfterSeconds
  - boss.ts:268-283 — defineJob's queueOptions never sets retentionSeconds, so every queue falls to pg-boss's built-in default
  - pg-boss defaults retention_seconds to 14 days and its maintenance sweep deletes any job still pre-active once that window passes, independent of deleteAfterSeconds or ever having been fetched
- **Impact:** If any queue's backlog ever holds a job unfetched for 14 days, pg-boss's own maintenance deletes it silently, with no retry and no DLQ routing (dead-lettering only fires on handler failure, not this queued-and-never-picked-up path) — work lost with nothing in the fleet's error-reporting ever seeing it.

#### `code:PER-07` — Signals feed polls refetch every loaded infinite-query page, not just page 1

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `signals-view.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - signals-view.tsx:322-329 — useInfiniteQuery(feedOpts) with refetchInterval: 30_000
  - queries.ts:58-66 — signalsFeedQuery is OFFSET-paginated (offset: pageParam)
- **Impact:** TanStack Query's default infinite-query refetch re-runs the queryFn for every page already loaded, in order, on each 30s poll. A user scrolled to 4-5 pages (200-250 rows) generates 4-5 sequential requests every tick from one open tab, and each is an OFFSET query whose DB-side skip cost grows with page depth — the deeper a user scrolls, the more expensive their idle polling becomes, compounding per open tab.

#### `code:PER-40` — Bulk signal actions fan out one HTTP request per selected row

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `signals-view.tsx`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - signals-view.tsx:726-741 — bulkSetAction: 'no bulk endpoint, so fan out setSignalAction per id', Promise.all(ids.map(...))
  - signals-view.tsx:805-813,830 — dismissSignals and its Undo path repeat the same per-id Promise.all
  - signals-view.tsx:861,872 — snoozeSignals and its Undo path do the same
- **Impact:** Shift-click range selection lets a user select every row across loaded pages, so one bulk track/dismiss/snooze click issues one concurrent POST per selected signal — tens to low-hundreds of simultaneous requests from a single click, and Undo replays the fan-out again. bulkMarkRead already proves a single batched endpoint is the intended pattern; the other three actions never got it.

#### `code:PER-15` — outrival-dlq jobs never reach a terminal state, so deleteAfterSeconds never fires

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `jobs.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - jobs.ts:15-18 — deadLetterQueue is defineJob'd with no worker; comment: 'no worker consumes it'
  - boss.ts:238-243 — deleteAfterSeconds counts only from a COMPLETED job
  - heartbeat.ts:69-72 — 'the DLQ's whole purpose is to hold rows in `created` until a human looks'
  - queue-admin.ts:240-248, admin/jobs.ts:38 — the only path off `created` is a manual /admin redrive click, never scheduled
- **Impact:** pg-boss only archives/deletes a job after completed/failed/cancelled; outrival-dlq by design registers zero workers, so every dead-lettered row sits in `created` forever unless a human redrives it — the table grows without bound for as long as anything dead-letters, on the same small dedicated Postgres the package elsewhere tunes to stay lean.

#### `code:PER-34` — ingest-blog-posts / ingest-case-studies silently inherit pg-boss's concurrency=1 default

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `jobs.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - jobs.ts:379-381 — ingestBlogPosts ('up to twenty sequential post fetches before any model call') has no `concurrency` key
  - jobs.ts:386-388 — ingestCaseStudies ('up to ten pages sequentially') likewise omits it
  - boss.ts:297-299 — workOptions only sets localConcurrency when config.concurrency is truthy; pg-boss's built-in default is 1
  - contrast every other I/O-bound queue in the file (scrapeMonitor, verifySignalDelta, generateBattleCard) carries an explicit, comment-justified concurrency value
- **Impact:** Both jobs are event-triggered per capture off the hourly scrape fan-out described elsewhere as reaching 'hundreds of monitors'; at concurrency 1 fleet-wide, any hour where more than a handful of competitors have blog/case-study updates serializes behind a multi-hour backlog with no queue-level signal that it's happening.

#### `code:PER-19` — robots.txt rules re-parsed and every pattern re-compiled to RegExp on every single request

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `robots.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - robots.ts:174-177 — rulesFor(body) calls parseGroups(body) from scratch on every invocation; only the raw text body is cached, never the parsed rules
  - robots.ts:110-119 — patternToRegex() does `new RegExp(...)` for every rule on every pathIsAllowed() call, never memoized
  - robots.ts:220-234 — isAllowed(url) and getCrawlDelayMs(url) each independently call getRobotsBody→rulesFor, so a single request site triggers TWO full re-parses of the same document
- **Impact:** Every fetch anywhere in the package re-splits, re-parses and re-regex-compiles the same origin's robots.txt from zero, twice, even though the raw body is already cached for 24h — on a multi-page crawl this is hundreds of redundant parses/compiles of the identical document, pure worker CPU.

#### `code:PER-39` — robots.txt fetch has no in-flight de-duplication, unlike the browser-launch pool in the same package

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `robots.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - robots.ts:83-102 — getRobotsBody: mem-cache miss + redis miss goes straight to fetchRobotsBody with no promise memoization keyed by origin
  - contrast scrape-patchright.ts:115,178-198 (launchingByTier) shows the package already knows this pattern and applies it to browser launches
- **Impact:** When several concurrent jobs touch the same not-yet-cached origin at once, each independently misses both caches and issues its own GET + parse of robots.txt, multiplying a request the 24h cache is meant to make happen once per origin per day.

#### `code:PER-20` — registerQueues()/syncSchedules() serialize 70+ independent pg-boss admin round trips at every worker boot

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - boss.ts:332 — `for (const def of registry) await boss.createQueue(...)` for all 53 registered jobs, sequentially
  - boss.ts:350-364 — drift-reconciliation loop likewise awaits boss.updateQueue() one at a time
  - jobs.ts:534-536 — syncSchedules() awaits boss.schedule() sequentially for all 19 CRON_SCHEDULES entries
  - pg-boss's own createQueue does an extra awaited getQueueCache(deadLetter) round trip whenever the queue declares a deadLetter
- **Impact:** Every worker process boot pays 70+ fully serialized Postgres round trips before the process can start working, delaying resumption of the hourly scrape fan-out on every redeploy/restart.

#### `code:PER-21` — Flat 7-day retention default applies regardless of queue volume

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/queue · `boss.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - boss.ts:275 — `deleteAfterSeconds: config.deleteAfterSeconds ?? 7 * 24 * 3600` applies whenever a job omits it
  - jobs.ts:203-220 — scrape-monitor's own comment describes an hourly fan-out of 'hundreds of monitors', yet sets no override
  - boss.ts:135-137 — the package is otherwise deliberately size-conscious about this Postgres ('a box whose whole job is to keep the job table small')
  - no defineJob call in jobs.ts overrides deleteAfterSeconds
- **Impact:** scrape-monitor alone can fan out hundreds of jobs hourly; at the default 7-day retention that's potentially tens of thousands of completed-job rows (payload + output JSON) held at any time, on the same setting a once-a-month cron gets.

#### `code:PER-25` — Docs-root discovery probes 14 candidate URLs strictly sequentially

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `docs/discover.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - docs/discover.ts:235-239 — loops 6 DOCS_SUBDOMAINS with `await reachable(...)` one at a time
  - docs/discover.ts:241-245 — then loops 8 DOCS_PATHS the same way, only after the subdomain loop fully finishes
  - docs/discover.ts:16-17 — HEAD_TIMEOUT_MS=5000 / GET_TIMEOUT_MS=8000 apply per probe
- **Impact:** For any competitor with no conventional docs surface, every probe runs to its own timeout before falling through — worst case ~14×5s ≈ 70s of serial wall-clock latency for one discoverDocsRoot() call.

#### `code:PER-31` — docs/wellknown/sitemap sources skip robots.txt + per-eTLD+1 rate limiting entirely

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `docs/discover.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - docs/discover.ts:82-113,235-245 — defaultFetchHtml/defaultReachable call safeFetch directly, up to 14 sequential probes with no gating
  - docs/pages.ts:102-121 — hashDocsPages fetches up to 20 pages at concurrency 5 via an unthrottled getHtml
  - docs/docs.scraper.ts:65-92 — probeText/fetchBytes use safeFetch with no isAllowed/awaitDomainSlot
  - wellknown/wellknown.scraper.ts:54-59 — Promise.all fires 4 simultaneous requests to the same origin
  - sitemap/sitemap.scraper.ts:26-38 drives up to 50 sequential, unpaced document fetches
  - contrast content/fetch.ts:52-53 and lib/crawler.ts:109-110 correctly gate every request through isAllowed()+awaitDomainSlot()
- **Impact:** A repo-wide grep shows only 4 call sites actually gate requests; docs/wellknown/sitemap each fire 5-60+ requests per run straight at the competitor's own domain, including concurrent bursts, with zero robots.txt check and zero pacing — contradicting the package's own collection doctrine. Practical cost is more blocked_403/soft_block refusals from anti-bot systems, which permanently marks sources unscrapable under this package's own doctrine.
- **Corrected by the refuter (kept, not overridden):** The robots.txt/rate-limit gap and the 4-vs-many-call-sites count are solid. The downstream causal claim ('permanently marks sources unscrapable') is less certain: unlike scrapePage/scrapeStatic, these three scrapers don't route a blocked probe through isRefusalReason/markedUnscrapable — a blocked sitemap/docs/wellknown fetch typically just returns null and falls through to the next candidate path, or throws a generic no_sitemap_found/no_docs_index, not necessarily the same permanent-refusal flagging. The compliance/doctrine violation stands; the specific 'permanently marks unscrapable' mechanism is unverified.

#### `code:PER-36` — Sitemap snapshot encodes the full URL list three times in one payload

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `scraper.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - sitemap.scraper.ts:68 — urls.map renders every URL (up to 5000) as an `<li>`
  - sitemap.scraper.ts:69 — the same array is JSON.stringify'd into a `<script>` island in the same html string
  - sitemap.scraper.ts:77 — a third copy goes into the separate `text` field (urls.join)
  - parse.ts:62-74 — parseSitemapDoc only ever reads the JSON island back; the `<li>` list has no downstream consumer
- **Impact:** For a competitor near the 5000-URL cap, the html payload uploaded to R2 carries the URL list twice (rendered `<li>`s + JSON island) purely for a machine-readable round-trip that only needs the JSON copy, inflating stored/uploaded bytes roughly 2-3x.

#### `code:PER-46` — Sitemap category counting computes categorizeUrl(u) twice per URL

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `scraper.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - sitemap.scraper.ts:60 — `counts.set(categorizeUrl(u), (counts.get(categorizeUrl(u)) ?? 0) + 1)` calls categorizeUrl on the same `u` twice in one statement
- **Impact:** categorizeUrl runs isComparisonUrl plus up to 10 regex tests; calling it twice doubles that work across up to 5000 entries every time a sitemap snapshot is built.

#### `code:PER-43` — deleteManyFromR2 issues delete batches sequentially, not concurrently

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `client.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - r2/client.ts:53-63 — bulk deletes (up to 1000 keys per DeleteObjectsCommand) run in a for-await loop, one round trip at a time
- **Impact:** The two real callers — erase-org.ts:104 (full org erasure) and purge-retention.ts:107 (periodic retention purge) — can plausibly exceed 1000 keys; each extra batch adds a full sequential network round trip instead of running concurrently. Not hot-path (infrequent jobs, not per-request), so impact is bounded to job duration rather than user-facing latency.

#### `code:PER-51` — getFromR2 buffers whole object into memory with no size guard

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `client.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - r2/client.ts:44-51 — getFromR2/getBytesFromR2 always call transformToByteArray() and hold the full object before returning
- **Impact:** This is the sole read path for stored HTML snapshots, called from ~15 sites across apps/workers and apps/api. Nothing caps input size, so a monitor pointed at an unexpectedly huge response has no ceiling before it lands fully in worker memory, and concurrent job fan-out multiplies that per-call cost with no backpressure.

#### `code:PER-01` — AI provider pool issues many sequential, unbatched Redis round trips per call

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `packages/shared/src/redis.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - provider-pool.ts:295-316 — for-loop over providers awaits redis.mget (2 keys), then observedTpm's own mget (2 more), one provider at a time
  - provider-pool.ts:227-240 — reserveTpm (incrby+expire) and reconcileTpm each issue separate awaited calls
  - provider-pool.ts:330-334 — trackUsage issues its own incrby+expire pair
  - provider.ts:359-361 — callLLM's retry loop re-runs pickProvider on every failover attempt, multiplying the cost toward O(N²)
  - packages/shared/src/redis.ts:33-42 — SafeRedis facade exposes get/set/incr/incrby/expire/mget individually, no pipeline/multi
- **Impact:** redis here is the real Upstash REST client, not a local cache, so every listed call is a genuine outbound HTTPS round trip. With 4 configured providers, one pickProvider call already pays up to 2N sequential round trips before any model call starts; the success path then adds 5 more (reserve/reconcile/track). This stacks tens to hundreds of ms of pure bookkeeping latency in front of EVERY AI call in the system, including interactive ones (Ask Outrival, onboarding analyze), and `expire` is resent even when a live TTL already exists.

#### `code:PER-02` — GET /api/products fetches the full selfProfile JSONB blob just to read two strings

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `apps/api/src/routes/products.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/products.ts:196-224 — SELECT for every product row includes the full `selfProfile`/`selfOverrides` JSONB (features, techStack, pricingTiers, etc.)
  - products.ts:379 — selfProfile is destructured out and discarded server-side (`({ selfProfile, ...p }) => {`)
  - products.ts:422-423 — only `selfProfile?.category?.value` and `selfProfile?.audience?.value` are ever read
  - products.ts:198-200 — the route's own comment: this endpoint is 'fetched by the shell on EVERY dashboard navigation'
- **Impact:** The single highest-traffic query in the API transfers the entire profile JSONB per product on every dashboard navigation, only to throw away everything but two short strings server-side — wasted DB I/O and serialization on the app's hottest read path, scaling with product count and profile size.

#### `code:PER-03` — generate-extractor is the one AI task with no size cap on the HTML it sends to the model

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `generate-extractor.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - generate-extractor.ts:91-93 — prompt = `<html>${prunedHtml}</html>` with no `.slice()`/`MAX_*_CHARS` guard, unlike every sibling extraction task
  - provider-pool.ts:27-31 (comment) — measured consequence already logged: 'generate_extractor sends ~12k tokens of pruned HTML and failed 198 times on Groq in a week' against Groq's fixed 8000-token ceiling
- **Impact:** Every other task in this package (extract-pricing MAX=12000, extract-jobs MAX=40000, extract-entitlements=14000, etc.) caps its input explicitly; this is the sole exception, and an unusually large or poorly-pruned page turns directly into a request too big for smaller-ceiling providers — a concrete, already-measured failure mode (198 failures/week on Groq), burning a failover slot and potentially the whole pool's last try.

#### `code:PER-04` — changes.snapshot_before_id has no index, forcing a scan in the retention purge's per-snapshot check

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/changes.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/changes.ts:8 vs :37-40 — only changes_monitor_detected_idx and changes_snapshot_after_idx exist; no index on snapshot_before_id
  - migrations/0000_magenta_invaders.sql:213,739 — only the FK constraint was ever created for snapshot_before_id, never an index
  - apps/workers/src/core/purge-retention.ts:71-74 — the snapshot-purge DELETE runs `NOT EXISTS (... ch.snapshot_before_id = sn.id OR ch.snapshot_after_id = sn.id)` per candidate snapshot
- **Impact:** changes is the highest-volume table in the schema (one row per detected diff across every source/monitor/scrape), and this correlated subquery runs for every org on every scheduled retention run. The snapshot_after_id arm uses its index; the snapshot_before_id arm does not, so Postgres seq-scans or bitmap-ORs per snapshot considered — an increasingly expensive, eventually timeout-prone maintenance job that burns metered Neon compute on every run.

#### `code:PER-05` — Plan-cap check fetches the whole competitor roster to test one row

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `plan.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - plan.ts:58 — rankedCompetitors does a full findMany of org competitors
  - plan.ts:76 — pausedByPlanCap calls rankedCompetitors then .slice
  - plan.ts:98 — competitorPlanCapState: same fetch-all, then .some() for one id
  - competitors.ts:1913 — GET /:id detail page calls pausedByPlanCap for ONE competitor
  - monitors.ts:324,412; monitor-alternatives.ts:42; competitors.ts:3481 — competitorPlanCapState on single-monitor/competitor actions
- **Impact:** Every competitor-detail page load and every single-monitor action (force rescan, accept/resume alternative, delete) re-reads and re-sorts the org's ENTIRE non-deleted competitor roster to answer a yes/no question about one row — on the polled dashboard flow, this turns an indexed lookup into an O(n) scan on the Business tier's largest rosters.
- **Corrected by the refuter (kept, not overridden):** The fact holds but 'O(n) scan on the Business tier's largest rosters' overstates it: maxCompetitors tops out at 50 (business tier, packages/shared/src/constants/plans.ts:144), so the re-fetched roster is bounded to at most a few dozen rows via an indexed orgId lookup — cheap in absolute terms, not a scalability risk. The legitimate complaint is the redundant-fetch *pattern* (full findMany + in-memory slice/some to answer a single-row yes/no), not an unbounded O(n) scan.

#### `code:PER-06` — signals.productIds has no GIN index for its documented containment query

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/signals.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/signals.ts:126-130 — comment: 'the per-product feed filters with productIds @> [id]'
  - signals.ts:145-153 — only two btree indexes (org+createdAt, competitor+createdAt) plus a unique on changeId; no GIN index on productIds
- **Impact:** Any per-product signal feed query filters an unbounded, ever-growing table on a jsonb containment predicate with no index support; only the org_id prefix of the composite index narrows rows, so the containment check is evaluated row-by-row over every signal the org has ever had, for every multi-product org.

#### `code:PER-08` — Ask agent runs its planned tool calls sequentially, not in parallel

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `agent.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - ask/agent.ts:120-124 — `for (const call of calls) { ...; await tool.run(...) }` awaits each planned tool call one at a time
  - the plan is produced in a single upfront pass with no re-planning between calls, so later args never depend on earlier results
- **Impact:** A plan with the maximum 6 tool calls pays the full latency of every tool back-to-back instead of the slowest one; combined with PER-27's compareCompetitors fan-out, a single Ask request can stack tens of sequential round trips before synthesis even starts, directly inflating a user-visible streaming response.
- **Corrected by the refuter (kept, not overridden):** Core claim (calls execute serially instead of concurrently, up to 6 back-to-back) is solid. The 'tens of sequential round trips' figure leans on PER-27 (compareCompetitors fan-out), which is outside this batch and unverified here — treat that specific number as unconfirmed, not the core defect.

#### `code:PER-09` — Soft-block markup check is computed on every capture despite comments claiming it's lazy

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `scrape-patchright.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - scrape-patchright.ts:415 — `isSoftBlockShell(text.length, statusCode, isContentCollapsed(extractContent(html)))` evaluates extractContent(html) unconditionally as a plain argument
  - scrape-patchright.ts:411 — adjacent comment: 'Only pay the parse in the rare near-empty branch', which the code doesn't do
  - block-detection.ts:73-75 — isSoftBlockShell's own docstring says it was designed to be conditional
- **Impact:** extractContent() does a full cheerio.load()+DOM walk on every single successful L1/L2 render — not just the rare near-empty case — while the render still holds a lease on the process-global, concurrency-shared Chromium pool (the same file documents a prior incident where pool contention dropped throughput from ~800 jobs/h to 5). Pure repeated work for the ~99% of captures with plenty of visible text.
- **Corrected by the refuter (kept, not overridden):** One of the three evidence citations is misattributed: block-detection.ts:73-75 discusses why escalating (vs. storing) is the safe default, not that isSoftBlockShell 'was designed to be conditional'. This doesn't undercut the core finding, which stands on the caller-side comment/code mismatch alone, but the citation itself is inaccurate and shouldn't be taken as an independent second source.

#### `code:PER-10` — Digest crons fetch per-org preferences/state before filtering to who is actually due

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `generate-daily-digest.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - generate-daily-digest.ts:104-120 — for every digest-enabled org, queries orgNotificationPreferences BEFORE checking whether it's that org's local morning hour
  - generate-weekly-digest.ts:153-160 — for every digest-enabled org, queries digests.findFirst (idempotency check) before any other work
- **Impact:** The daily job runs hourly and does one full query per digest-enabled org every run, even though only ~1/24 of orgs actually proceed on any given run — pure waste that grows linearly with the org base. The weekly job pays the analogous per-org existence check before its necessary AI generation step.
- **Corrected by the refuter (kept, not overridden):** For the daily job specifically, the framing 'fetches preferences BEFORE checking whether it's due' is misleading, not inflated-but-still-real: the org's timezone/quietHoursEnd (from orgNotificationPreferences) is the only way to compute whether 'now' is that org's local morning hour, so the prefs query cannot be skipped for not-yet-due orgs — it IS the due-check's input, not wasted work ahead of it. The defensible issue is the N+1 shape itself (one sequential round trip per org instead of a single batched query for all digest-enabled orgs), which holds for both the daily prefs lookup and the weekly idempotency check — the latter genuinely could be a single batched pre-check since it needs no per-org computation.

#### `code:PER-11` — Signal read/action/snooze mutations do a SELECT-then-UPDATE instead of one scoped statement

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `signals.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - signals.ts:1078-1085 (PATCH /:id/read), :1099-1114 (/:id/action), :1144-1154 (/:id/snooze) — each first runs a findFirst purely for existence/ownership, then a separate update filtered only by id
  - contrast notifications.ts:39-49 and saved-views.ts:101-106 — same 'scoped update, 404 if nothing matched' intent expressed in a single statement in this same package
- **Impact:** Three of the most frequently-fired mutations in the feed UI — plausibly one per click/row — each pay two DB round trips where one would do, adding needless latency on Neon's per-hop connection cost.

#### `code:PER-12` — Favicon proxy cache evicts everything at 500 entries instead of the oldest

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `route.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - favicon/route.ts:12,16 — `MAX_ENTRIES = 500`, `const cache = new Map(...)`
  - route.ts:86-87 — `if (cache.size >= MAX_ENTRIES) cache.clear();` immediately followed by `cache.set(...)` — a full wipe instead of evicting the single oldest key
- **Impact:** Once the process-local cache fills, the next miss discards all 500 warm entries at once. Every subsequently-rendered avatar for a previously-cached domain then re-triggers the sequential Google→DuckDuckGo fetch chain (up to 2×4s timeout each) simultaneously across concurrent requests — a thundering herd that recurs every time the app crosses the 500-domain mark, more often as the competitor base (208+) grows.

#### `code:PER-13` — Org plan re-fetched redundantly, including inside a per-product loop

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `candidates.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - candidates.ts:617 — assertWithinLimit called inside `for (const productId of productIds)` with no opts.plan, so plan.ts:221 re-queries organizations.plan every iteration
  - battle-cards.ts:401 — getOrgPlan called again right after aiIntensiveRateLimit middleware already fetched the same org's plan
  - my-product.ts:657 — same double-fetch pattern behind aiIntensiveRateLimit
- **Impact:** An 'all products' discovery refresh issues one identical organizations.plan SELECT per product in the loop — re-answering a value that cannot change mid-request. The battle-card-generate and rescan routes each pay a second plan lookup on top of the rate-limit middleware's, on every AI-intensive call.

#### `code:PER-14` — signal-batching scans the entire signals table platform-wide, unbounded

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `signal-batching.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - signal-batching.ts:44-68 — the batching select carries no `.limit()` and no `eq(signals.orgId, ...)`, a cross-tenant scan bounded only by the time window
  - signal-batching.ts:39-42 — orgNotificationPreferences.findMany loads every org's row platform-wide to build an exclusion set
  - contrast schedule-scraping.ts in the same package explicitly caps per org before enqueue
- **Impact:** Runs every 6 hours and its cost grows with total platform signal volume, not any single org's — as tenant count grows this is the one query in the package whose row count is unbounded by any per-org or per-run cap.
- **Corrected by the refuter (kept, not overridden):** Evidence bullet 2 overstates slightly: `orgNotificationPreferences.findMany` filters to `eq(batchingEnabled, false)` — it loads only orgs that explicitly disabled batching, not literally every org's row platform-wide. The primary claim (the candidates select is unbounded) still holds independently.

#### `code:PER-16` — ai_quality_checks has no index for its date-range dashboard queries

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/db · `ai-quality-checks.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - ai-quality-checks.ts:75-82 — three composite indexes exist ((targetType,targetId), (flaggedForHumanReview,createdAt), (aiTask,createdAt)) but none leads with createdAt alone
  - ai-quality.ts:153-238 — getQualityReviewStats/getQualityByTask/getConfidenceDistribution all filter solely on `gte(createdAt, since)`
- **Impact:** None of the three composite indexes has createdAt as a usable leading column for a date-only range scan, so all three ops-dashboard aggregate queries force a sequential scan of the whole table — a table that accumulates one row per graded AI generation and only grows.

#### `code:PER-17` — 23 admin pages fetch full unpaginated collections, most acutely Users and Feedback

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `page.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - admin/users/page.tsx:6 — `adminFetch("/api/admin/users")` with no limit/cursor/page param
  - admin/users/view.tsx:22-24,44 — the full array is held in state and rendered as one `<Table>`; search is the only narrowing, not a default page size
  - admin/feedback/page.tsx:6, view.tsx:67-68 — same shape for feedback
  - contrast admin/jobs/page.tsx:6-10 (real cursor pagination) and admin/audit/page.tsx:15,20 (explicitly caps at 100) show the team already knows the pattern
- **Impact:** Every admin visit to /admin/users or /admin/feedback ships and renders the entire table, and because adminFetch always sets `cache: "no-store"`, that full payload is refetched from scratch on every page load with zero caching — currently modest but with no ceiling as users/orgs grow.
- **Corrected by the refuter (kept, not overridden):** The '23' is simply the total count of admin page.tsx files under apps/web/src/app/(admin)/admin (verified: exactly 23 exist) — not a verified count of pages with the unpaginated-fetch defect. Only Users and Feedback are directly confirmed to have it; jobs and audit are confirmed NOT to; the remaining ~19 pages were not individually checked in this pass.

#### `code:PER-18` — ingest-content-items typeNewEntries issues one UPDATE per row instead of a batched write

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `ingest-content-items.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - ingest-content-items.ts:600-610 — keyword-typed pass: one db.update per row inside the loop (up to MAX_TYPED_PER_RUN=40)
  - ingest-content-items.ts:612-641 — AI-typed pass: BATCH_SIZE=10 items per loggedAi call, then one db.update per matched entry inside that batch loop
- **Impact:** A single ingest run can issue up to ~80 individual single-row UPDATE statements where a multi-row batched update would do the same work; runs per capture across every changelog-source monitor, so round-trip cost compounds with monitor count.
- **Corrected by the refuter (kept, not overridden):** Worst case is bounded by MAX_TYPED_PER_RUN=40 individual UPDATE statements per run, not '~80' — the two passes partition the same pending set rather than both processing the full 40.

#### `code:PER-22` — Every /admin/* page load serializes a session-check fetch before its data fetch

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web · `layout.tsx`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - admin/layout.tsx:16 — `await requireAdmin()` blocks rendering of children until it resolves
  - admin/_lib/server.ts:26-32 — requireAdmin() itself awaits a full round trip to /api/auth/get-session
  - every page.tsx then does its own await adminFetch(...) for page data, which cannot start until the layout's await returns
  - no loading.tsx exists anywhere under admin/, so there is no streamed/Suspense boundary
- **Impact:** Two full API round trips execute sequentially instead of in parallel on every admin navigation across all 23 pages — the session check gains nothing from running first, adding a fixed few hundred ms of dead time on the one surface with no browser traffic to catch it in practice.

#### `code:PER-23` — detect-new-competitors writes one INSERT per discovered candidate

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `detect-new-competitors.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - detect-new-competitors.ts:169-186 — `for (const d of fresh) { ... await db.insert(...) }` issues one round-trip per candidate (up to 20 per product)
  - detect-new-competitors.ts:49-67 — organizations.findMany loads every onboarded org unconditionally; the per-org cadence check is then applied in application code inside the loop rather than in the WHERE clause
- **Impact:** For an org with several products each surfacing up to 20 fresh candidates, this is up to dozens of sequential round trips where one batched multi-row insert would do; the cadence filter also means every onboarded org's row is fetched every weekly run even though most are skipped immediately after.

#### `code:PER-24` — Unguarded isToday()/raw date-fns format() causes real SSR/hydration mismatches at 5 sites

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web · `as-of.tsx`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - as-of.tsx:10-12,46 — calls isToday(d) + format(d, "HH:mm") directly in a client component's render path, no suppressHydrationWarning
  - freshness-dot.tsx:74-80 — `nextTs > Date.now()` gates whether an entire node renders at all — a structural, not just textual, diff
  - same unguarded pattern at monitor-status.tsx:183, activity-tab.tsx:33, signal-comments.tsx:487, signals-view.tsx:81
  - team has already fixed this exact class elsewhere: ai-status-banner.tsx:69-72 and overview-lead.tsx:89-92 apply suppressHydrationWarning; format-date.ts:18-21 names the tradeoff explicitly
- **Impact:** Any visitor whose local calendar day or AM/PM-vs-24h locale differs from the server's at render time gets a real hydration mismatch — React discards and re-renders the affected subtree, and in signals-view.tsx:81 the mismatched value feeds a grouping label, so the visual regrouping can flicker post-hydration.

#### `code:PER-26` — toStrictJsonSchema is recomputed from the Zod schema on every call for the package's highest-volume tasks

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `json-schema.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - json-schema.ts:15-20 — toStrictJsonSchema: z.toJSONSchema + recursive harden walk, no memoization
  - grounded-call.ts:213-215 — called fresh inside groundedAiCall on every invocation for JSON_SCHEMA_TASKS
  - grounded-call.ts:79,90 — JSON_SCHEMA_TASKS = generate_signal, narrate_change; 'generate_signal runs on every change' per the package's own note
- **Impact:** generate_signal fires once per detected change platform-wide; every call rebuilds the requested schema and walks toJSONSchema's full output tree again, even though the schema for a given taskName never varies — pure CPU repeated per request that a module-level constant per taskName would compute once.

#### `code:PER-27` — compareCompetitors Ask tool fans out to ~20-30 queries instead of batching

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/api · `tools.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - ask/tools.ts:775-816 — compareCompetitors maps up to 6 competitor ids, each doing up to 4 dimension calls (pricing/jobs/reviews/tech-stack) inside Promise.all
  - tools.ts:81-90 — each of those 4 tools independently re-checks org ownership that compareCompetitors already established for the whole batch
  - tools.ts:238-280, :337-379 — getPricingHistory and getReviewThemes each issue 2 separate round trips on top of the ownership check
  - tools.ts:596-660 (rankPricing) shows the batched IN(...) alternative already exists in the same file
- **Impact:** Every 'compare X vs Y' question through Ask Outrival can issue dozens of individual DB round trips (many duplicate ownership checks) instead of ~4 batched IN(...) queries, directly inflating latency of an already rate-limited, user-facing streaming response.

#### `code:PER-28` — Faithfulness judge and self-check never use the pool's own prefix-caching (F2) pattern

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `judge-claim.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - faithfulness/judge-claim.ts:53-64 — buildJudgePrompt interpolates up to 12,000 chars of sourceText into the per-call prompt, not the byte-identical system field
  - faithfulness/verify.ts:88-119 — the loop calls judgeClaim up to MAX_JUDGE_CALLS (12) times per faithfulness check, resending the identical sourceText each time
  - self-check/run-self-check.ts:36-61,63 — systemPrompt mixes static reviewer instructions with variable output/citations/sourceText in one template literal; complete() is called with only prompt, never system
  - self-check/run-self-check.ts:81-83 — this runs on every generate_battle_card call by default
  - tasks/classify.ts:188 and provider.ts:78-84 document the fix already in use elsewhere (pattern 'F2'): put the invariant payload in system so Groq/Cerebras/Claude auto-cache the prefix
- **Impact:** A gated generation with several unsupported claims pays for the same ~3k-token source block up to 12 times in one faithfulness check; self-check runs at full 'smart'-tier price on every battle-card generation plus every low-confidence output package-wide — both re-paying for tokens the codebase's own established F2 pattern would let the provider cache after the first call.

#### `code:PER-29` — refresh-stale-battle-cards re-scans the full stale list once per org instead of grouping by org up front

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `refresh-stale-battle-cards.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - refresh-stale-battle-cards.ts:168-188 — `for (const org of orgs) { ... stale.filter((s) => s.orgId === org.id) ... }` is an O(orgs × stale) nested scan
- **Impact:** Minor at current scale (orgs and stale-card counts are both bounded by opted-in, non-free orgs), but is the textbook nested-scan-where-a-Map-belongs pattern, and grows quadratically as both lists grow.
- **Corrected by the refuter (kept, not overridden):** The nested scan is real (refresh-stale-battle-cards.ts:168-188: `for (const org of orgs) { ... const mine = stale.filter((s) => s.orgId === org.id)...}`), but it is pure in-memory JS array filtering with zero DB/network I/O per iteration — not a DB round-trip pattern. `orgs` is already filtered to paid, opted-in orgs (line 53-61) and `stale` to competitor cards with a moved signal; at any plausible current or near-term scale (dozens to low hundreds of orgs and stale cards) this completes in sub-millisecond time. The finding's own text already concedes this ('Minor at current scale'), so 'textbook nested-scan-where-a-Map-belongs' overstates a cost that is effectively free.

#### `code:PER-30` — scrape-monitor retries repeat the full paid scrape and orphan R2 objects

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `scrape-monitor.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - scrape-monitor.ts:216-220 — job takes the queue default retryLimit (2, so 3 total attempts) with no idempotency key
  - scrape-monitor.ts:900-965 — the paid browser/proxy scrape runs unconditionally at the top of every attempt with no check for whether a prior attempt already fetched the content
  - scrape-monitor.ts:1188-1200 vs :1336 — two R2 PUTs happen ~130 lines before the snapshot DB row is written; any throw in that window or the ~1400 lines after causes pg-boss to retry the whole handler from scratch
  - purge-retention.ts:78-115 — retention cleanup only finds R2 objects via committed snapshots rows; an object from a failed attempt that never reached the DB insert is never found or deleted by anything in the repo
- **Impact:** A downstream exception after the R2 upload forces up to 2 extra full re-scrapes per monitor — repeating paid datacenter egress and browser CPU time — and permanently leaks the first attempt's R2 html/png objects, since no code path can locate or delete an object that never got a DB row.

#### `code:PER-32` — ingest-case-studies writes two per-entry INSERTs instead of batching the extraction batch

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `ingest-case-studies.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - ingest-case-studies.ts:230-262 — inside a per-entry loop nested under a page-batch loop, each entry does its own db.insert(caseStudies) round trip
  - ingest-case-studies.ts:262-275 — the same iteration calls recordCustomers with a single-element array per entry rather than batching entries from the batch first
- **Impact:** Each AI extraction batch that returns N case studies costs 2N sequential DB round trips (caseStudies insert + knownCustomers insert) where 2 batched multi-row inserts would suffice — mirrors the per-row write pattern in PER-18, suggesting the same anti-pattern recurs across this ingestion family.

#### `code:PER-35` — score-overlap.ts has no cap on the candidate list serialized into the prompt

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `score-overlap.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - tasks/score-overlap.ts:55 — `${JSON.stringify(candidates, null, 2)}` embeds the full, uncapped array verbatim
  - score-overlap.ts:97-104 — maxTokens was raised to 4096 with a comment noting 'the pool now unions three recall sources, so budget for the widened list' — an output-side mitigation only, no input-side cap
- **Impact:** Every other multi-item task in this package defensively caps its own input (digest.ts DIGEST_MAX_SIGNALS=30, ask.ts's per-result budget, mine-job-facts.ts's per-JD char cap); score-overlap.ts does not, so a widened candidate pool scales prompt tokens and cost linearly with no ceiling, risking the same maxTokens overrun the comment tries to avoid.
- **Corrected by the refuter (kept, not overridden):** The fact holds (score-overlap.ts itself has no candidate-count cap: line 55 `JSON.stringify(candidates, null, 2)` is unbounded, and the maxTokens=4096 bump at line 97-100 is output-side only) and the comparison to digest.ts/ask.ts/mine-job-facts.ts's input caps is accurate (DIGEST_MAX_SIGNALS=30, ASK budget logic, MAX_JD_CHARS=4500 all verified present). But the sole current caller today (detect-new-competitors.ts:156, via findSimilarCompanies in discover.ts) already bounds the pool to MAX_POOL=45 (discover.ts:226, reachability-filtered) before scoreOverlap ever sees it, so today's real-world exposure is bounded, not literally 'linear with no ceiling.' The legitimate risk is architectural: unlike its siblings, this task relies entirely on caller discipline rather than a defensive cap of its own, which would matter for any future/different caller.

#### `code:PER-37` — Discovery reachability check materializes the full response body before using 30KB of it, fanned to 45 concurrent candidates

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `discover.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - discovery/discover.ts:170 — `(await res.text()).slice(0, PARKING_SCAN_CHARS)` downloads and buffers the ENTIRE body before truncating to 30,000 chars
  - guarded-fetch.ts:19-38 — safeFetch enforces no response-size ceiling at all
  - discover.ts:336-338 — isLiveProduct runs via Promise.all over up to 45 candidates, so up to 45 unbounded bodies can be in memory concurrently
- **Impact:** A handful of the up to 45 discovery candidates serving multi-MB pages (or an adversarial one streaming until the 5s timeout) spikes worker memory during a single onboarding/discovery run, for a check that only ever reads the first 30KB.

#### `code:PER-38` — audit_log carries zero indexes on an unbounded append-only table

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `audit_log.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - audit_log.ts:6-14 — full table definition (id, actorEmail, action, targetType, targetId, metadata, createdAt) with no index block at all
- **Impact:** Every admin-panel read of this trail (recent actions, filter by actor or target) is a full sequential scan, and the table only grows with no visible retention policy. Every comparable append-only table in analytics.ts carries at least a recordedAt/createdAt index.
- **Corrected by the refuter (kept, not overridden):** The admin /audit-log route (ORDER BY created_at DESC LIMIT 100) lacks a supporting index, which matters only as the table grows past what a sequential scan+sort handles cheaply — there is no actor/target filter today to make worse, and the absence of purging is a documented deliberate choice (audit_log is operator data), not a gap.

#### `code:PER-41` — Structural-changes list has no LIMIT on a status-filterable, ever-growing table

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `structural-changes.ts`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - structural-changes.ts:42-48 — findMany with inArray(competitorId,...) + status filter, no `limit`
- **Impact:** Unlike every comparable list route in this package (notifications, digests, standing-queries, candidates all cap at 100-200 rows), this one ships the full row set for whatever status the org has accumulated; current volume is low but this is the one list endpoint diverging from the package's own limit convention.

#### `code:PER-42` — isClaimSupported re-parses the same source text on every claim instead of once per faithfulness check

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/ai · `score-claims.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - faithfulness/score-claims.ts:28-37 — isClaimSupported(claim, sourceText) calls parseLabelledDiff(sourceText) internally
  - score-claims.ts:39-41 — scoreClaims maps isClaimSupported over up to MAX_CLAIMS=25, re-running the identical parse each time
- **Impact:** parseLabelledDiff's regex scan of up to 12,000 chars is redone up to 25 times per faithfulness check instead of once outside the loop; per-call cost is small (regex, not a model call) so severity is lower, but it runs on the same hot path (every gated generation).

#### `code:PER-44` — purge-retention loops every org sequentially with ~15 DELETE round trips each, no early skip

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `purge-retention.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - purge-retention.ts:33 — `for (const org of orgs)` over the full organizations table
  - purge-retention.ts:37-96 — 10 individual DELETE statements plus a 5-table loop, all per org, none skipped even when the org has nothing past its cutoff
- **Impact:** Daily cron cost is O(orgs × ~15) sequential round trips regardless of how much data is actually past retention; retention windows only vary by 4 plan tiers, so this could collapse to a handful of set-based DELETEs instead of per-org iteration.

#### `code:PER-45` — detect-structural-changes issues 3 sequential queries per competitor instead of batching

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/workers · `detect-structural-changes.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - detect-structural-changes.ts:51 — `for (const comp of comps)` iterates every non-deleted, non-self competitor across ALL orgs
  - detect-structural-changes.ts:55-61,64-72,76-81 — monitors.findFirst, snapshots.findMany, structuralChanges.findFirst per competitor
- **Impact:** Weekly cron does 3N sequential DB round trips for N tracked competitors platform-wide where 3 batched queries would do the same job; schedule-scraping.ts in the same package already shows the batched pattern this file doesn't follow.

#### `code:PER-47` — industryLabel() rebuilds its lookup object on every call

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** packages/shared · `industry-catalog.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - industry-catalog.ts:168-183 — the 16-entry `explicit` Record is allocated fresh inside the function body instead of at module scope
  - called once per competitor/industry inside .map() loops at positioning.ts:299, competitors.ts:2939, ingest-case-studies.ts:537, generate-battle-card.ts:120, signal-facts.ts:1036, audience-profile.ts:134,144
- **Impact:** Work that could be computed once per process is redone once per request per item; per-call cost is a handful of microseconds, so this is a minor find, but it's the one clean instance in this package of a static object rebuilt per call with verified real call sites.

#### `code:PER-49` — Global search runs unbounded leading-wildcard ILIKE with no trigram index

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `search.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - search.ts:34-91 — Promise.all of three ILIKE `%q%` queries against competitors, signals, digests
  - search.ts:80-89 — the digests query casts the full JSONB digest body to text per row
  - analytics.ts:438, digests.ts:24 confirm only (orgId, timestamp) B-tree indexes exist — no pg_trgm/GIN index anywhere in the schema
- **Impact:** The Cmd-K search endpoint can only use the orgId index to narrow rows, then must filter every signal (and every digest, cast to text) with a leading-wildcard ILIKE it can't index-seek on — for an org with a long history this scans thousands of rows per keystroke.

#### `code:PER-50` — GDPR export materializes an org's entire history in one in-memory JSON response

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/api · `settings.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - settings.ts:166-197 (GET /settings/export)
  - settings.ts:176 — unbounded select on signals
  - settings.ts:178-186 — same unbounded select for digests, notifications, products, candidates, battleCards, monitors, jobPostings, reviews, all inside one Promise.all
- **Impact:** For a mature org this pulls every signal, digest, notification, candidate, battle card, monitor, job posting and review ever recorded fully into the Bun process's memory, then serializes it as one JSON body with no streaming — on infra already noted as memory-constrained. An old, active org's export could be tens of thousands of rows in a single request/response cycle.

#### `code:PER-52` — scrapeDirect has no response-size ceiling, unlike the blog post enrichment path

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `scrape-direct.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - scrape-direct.ts:13-17 — safeFetch then `await res.text()` with no content-length or byte-count check
  - contrast content/fetch.ts:61-67 caps the same kind of L0 fetch at MAX_POST_BYTES (500KB), checking both declared and actual body size
- **Impact:** scrapeDirect is the L0 path for every monitored source. A page with an unusually large inlined hydration payload or mis-served asset is read fully into memory with no ceiling, then re-parsed multiple times downstream, repeated per concurrent job — the exact scenario content/fetch.ts already guards against for blog posts, left unguarded on the primary scrape path.

#### `code:PER-53` — No migration ever uses CREATE INDEX CONCURRENTLY, and the runtime migrator transaction-wraps every file

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `migrate.ts`
- **Effort:** `M` · **fix risk:** `high`
- **Proof:**
  - migrate.ts:1-35 — prod runtime migrator wraps each migration file in a transaction by default; this is what Coolify's pre-deploy step runs
  - grep across all 84 migration files found zero uses of CONCURRENTLY
- **Impact:** Any future index added to an already-populated hot table (signals, changes, snapshots, or an analytics.ts time-series table) will take a blocking lock for the full duration of the index build during the mandatory pre-deploy migration step, since CONCURRENTLY cannot run inside a transaction. On a large table this risks stalling concurrent worker writes or tripping timeouts during deploy.

#### `code:PER-54` — Blog index post-link extraction re-scans growing DOM subtrees per candidate anchor

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/scrapers · `blog-links.ts`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - content/blog-links.ts:151-167 — for each of up to MAX_CANDIDATES=400 anchors, climbs up to MAX_CARD_DEPTH=6 ancestor levels, re-scanning and re-canonicalizing every anchor in the growing subtree at each level
  - blog-links.ts:31 — MAX_CANDIDATES=400 documents the expected anchor volume
- **Impact:** On a flat/dense blog listing template, the ancestor climb quickly reaches a container holding most of the page's anchors, so the per-candidate re-scan approaches full-page-anchor-count work for every candidate — up to ~O(candidates²) traversals on a single extractPostLinks() call, run on every blog capture.

#### `code:PER-55` — One-shot email-canonical backfill loads the entire user table and updates row-by-row

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** packages/db · `backfill-email-canonical.ts`
- **Effort:** `S` · **fix risk:** `medium`
- **Proof:**
  - backfill-email-canonical.ts:33-34 — `SELECT id, email, email_canonical FROM "user"` with no LIMIT/paging
  - backfill-email-canonical.ts:38-43 — one UPDATE per row inside a JS for-loop instead of one batched statement
- **Impact:** Bounded by current user-table size so not urgent today, but the pattern (full-table SELECT into memory, then N serial UPDATE round trips) is exactly what breaks if this script is re-run later against a materially larger table.
- **Corrected by the refuter (kept, not overridden):** The fact holds (backfill-email-canonical.ts:33-34 does an unbounded `SELECT id, email, email_canonical FROM "user"`, and :37-43 loops one `UPDATE` per row), but the finding's own framing ('bounded by current user-table size, not urgent today') already discounts the severity correctly. One further mitigation the finding doesn't mention: this script's entire purpose is already fulfilled — migrations 0019/0020 show the `user_email_canonical_idx` was already promoted to UNIQUE, so the backfill-then-promote sequence this script exists for has already run in the environments that matter. It's a manually-invoked, one-shot ops script (`pnpm --filter @outrival/db db:backfill-email-canonical`), not on any recurring or automated path, so the realistic future trigger is a fresh (small) staging branch provisioning, not a 'materially larger' table.

### 6.4 Product and interface (57)

Product-surface findings carry a URL plus a screenshot under
`~/.outrival-audit/2026-08-16/shots/` instead of a `file:line`, or both where the
crawl and the code agreed. They have no package attribution: the crawl saw the
rendered product, not the tree.

#### `ux:64` — Icon-only toolbar and per-row table actions look under the ~44px touch-target minimum

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard__tablet__dark` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard__tablet__dark.jpg (top-bar cluster: search, Ask, history, theme toggle, bell, avatar)
  - shots/dashboard_competitors__mobile__dark.jpg (per-row checkbox + drag/menu glyph)
- **Impact:** The persistent top-bar icon cluster and each competitor row's checkbox/kebab glyph appear small (~20-32px by visual estimate), tightly-pitched hit areas repeated on every dashboard screen at mobile and tablet; no computed CSS size was available so this is a visual read, not a measured one.
- **Corrected by the refuter (kept, not overridden):** Measured (not just visually estimated): topbar icon buttons are 32px (Button size="icon-sm"), the per-row kebab trigger is 24px (h-6 w-6), and the per-row select checkbox is 16px (size-4) — all below the ~44px touch-target guideline, confirmed in apps/web/src/components/dashboard/select-box.tsx, competitors-list.tsx, and ui/button.tsx.

#### `ux:73` — rss.xml trips document-title/html-has-lang (likely crawler artifact, not a user-facing gap)

- **Status:** verified true · votes 2, against 1 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `polish`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - route /blog/rss.xml, axe rules 'document-title' and 'html-has-lang', 4 nodes each
- **Impact:** axe is evaluating the raw XML feed as if it were an HTML page (no <title>, no <html lang>); RSS is consumed by feed readers, not rendered to end users or assistive tech as a page, so this is probably a crawl-tooling artifact rather than a genuine barrier - flagged for completeness, not as a fix priority.

#### `ux:78` — Legal Notice, Terms and Privacy publish the literal placeholder "[À COMPLÉTER]" as the publisher's identity

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/lib/legal/entity.ts` · severity `blocker`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - https://outrival.app/legal-notice (screenshot: /home/tmfzi/.outrival-audit/2026-08-16/shots/legal-notice__laptop__light.jpg — Company name/Legal form/Share capital/Registered office/RCS/SIRET/VAT all render "[À COMPLÉTER]", Publication Director too)
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/privacy__laptop__light.jpg (Section 1 'Data controller' also renders the placeholder)
  - /home/tmfzi/outrival/apps/web/src/lib/legal/entity.ts:11-38 (TODO = "[À COMPLÉTER]"; legalName, legalForm, capital, siret, rcs, vat, address, publicationDirector all set to TODO, with a comment flagging this as a real legal-exposure gap before production)
  - /home/tmfzi/outrival/apps/web/src/app/terms/page.tsx:26, /home/tmfzi/outrival/apps/web/src/app/privacy/page.tsx:25-26, /home/tmfzi/outrival/apps/web/src/app/terms-of-sale/page.tsx:25 (contracting party name interpolated from the same TODO constant)
- **Impact:** The live 'Legal Notice' fails the LCEN Article 6 mandatory-publisher-identification it cites by name, the Privacy Policy leaves the GDPR-required 'data controller' unidentified, and every paid Terms of Sale is formed with an unnamed placeholder party; the bracketed French string also sits inside otherwise-English legal pages, which the project's runtime-language rule treats as a defect with no exceptions.

#### `ux:80` — Dashboard 'Ask' button has no accessible name on mobile

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/dashboard/topbar.ts` · severity `blocker`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/dashboard/topbar.tsx:46-55
  - axe rule 'button-name' (critical): 104 nodes, 45 routes, 98 of them mobile-only (49 dark + 49 light)
  - shots/dashboard__mobile__light.jpg (icon-only sparkle button in the top bar, no visible label)
- **Impact:** The Ask button's only label is `<span className="hidden sm:inline">Ask</span>`, which is hidden below the sm breakpoint (mobile viewport). No aria-label is set, unlike the adjacent Refresh button at topbar.tsx:67 which correctly has aria-label='Refresh'. Screen-reader users on mobile cannot identify or reliably activate the app's primary AI entry point, and this single shell component accounts for the button-name violation on nearly every /dashboard/* route.

#### `ux:82` — Dashboard shell overflows tablet by exactly 55px on 44/45 authenticated routes

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/` · severity `blocker`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - failures.json: 44 unique routes at viewport=tablet, overflowPx=55 exactly (every /dashboard/* route, /auth, /onboarding)
  - shots/dashboard__tablet__dark.jpg
  - shots/dashboard_competitors__tablet__light.jpg
- **Impact:** The primary left sidebar renders fully expanded with text labels at 768px (identical to laptop/desktop) instead of collapsing or going off-canvas, so the sidebar + main content combined width forces a 55px horizontal scrollbar on virtually every screen a signed-in user reaches on an iPad-width device (768 CSS px is standard iPad portrait). Every non-app/public route (0 of them) is unaffected, and only one real dashboard route (/dashboard/signals) escapes, pinpointing the shared authenticated-layout shell (not per-page content) as the cause.

#### `ux:83` — Discovery candidate rows nest real buttons inside a role=button div

- **Status:** verified true · votes 2, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/app/dashboard/discovery/discovery-view.ts` · severity `blocker`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/app/dashboard/discovery/discovery-view.tsx:444-518
  - route /dashboard/discovery, axe rule 'nested-interactive': 72 nodes, all 4 viewport/theme combinations (18 each)
- **Impact:** Each row in the competitor-discovery queue is a <div role="button" tabIndex={0} onClick={onToggle}> that itself contains real <button> elements (Restore, Delete, and presumably Track/Dismiss below). Nested interactive controls are unreliable for screen readers to parse and operate, making the core discovery-triage workflow (approve/dismiss new competitor candidates) effectively unusable via assistive tech.

#### `ux:01` — Homepage H1 contains a literal duplicated word in raw HTML

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - results.json: path=/, h1="Your competitors movedmoved again.You'll know by Monday." (identical across all 8 viewport/theme combos)
  - raw HTML: <h1 class="lp-h1">Your competitors <span class="sr-only">moved</span><span class="lp-cycle" aria-hidden="true"><span>moved</span>...</h1>
- **Impact:** aria-hidden does not remove text from the DOM/textContent, so any crawler or LLM answer-engine doing naive text extraction reads the flagship page's headline as "movedmoved" — a content defect on the single most important page for both SEO and AEO summarization.

#### `ux:08` — Ask: rapid double-submit fires two separate AI backend calls, not one

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - Filled the Ask textbox with 5000 chars, pressed Ctrl+Enter twice in immediate succession
  - Network log: two distinct POST /api/ask -> 200 requests, back to back
  - Only one answer ever rendered in the UI; the second response is discarded silently
  - /home/tmfzi/.outrival-audit/2026-08-16/adversarial-log.md, Section 1 (cont.)
- **Impact:** No client-side debounce/lock on the send action. On a product with a hard 10-actions/hour AI cap, one accidental double-Enter silently burns 2 of a user's 10 allowed actions for what they experience as a single question, with no indication it happened twice.

#### `ux:13` — Meta descriptions run well past SERP truncation on 6 key pages

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - / meta description: 250 chars
  - /blog/competitor-changed-pricing-founder-playbook: 219 chars
  - /blog/what-crayon-actually-costs-in-2026: 209 chars
  - /blog/how-outrival-scraping-pipeline-works: 197 chars
  - /alternatives/best-competitive-intelligence-tools: 192 chars
  - /vs/diy: 181 chars
- **Impact:** Google truncates snippets around ~155-160 characters; the homepage description cuts off mid-word and drops the closing differentiator "EU data storage" entirely, and all three blog posts plus two programmatic pages lose their final clause in search results and link previews.

#### `ux:24` — No third-party credibility signal anywhere in the sampled pages

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/home__laptop__light.jpg
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/about__laptop__light.jpg
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/vs_crayon__laptop__light.jpg
- **Impact:** Across home, pricing, about, and both /vs pages checked, there is no customer logo, review-site badge, testimonial, or usage/customer count. The only 'reviews' mentioned is a monitoring feature for the CUSTOMER's own competitors, not proof of Outrival's track record.

#### `ux:37` — All /vs/* and /alternatives/* pages share one generic OG image

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - og:image on /vs/crayon, /vs/klue, /vs/diy, /alternatives/crayon, /alternatives/klue, /alternatives/best-competitive-intelligence-tools all resolve to the identical https://outrival.app/opengraph-image
  - contrast: blog posts already get a per-page generated image, e.g. /blog/how-outrival-scraping-pipeline-works/opengraph-image?a19e6616f24e0415
- **Impact:** The 6 comparison pages are the most naturally shareable pages on the site (title contains a competitor name), but every one shows the same generic site card on social/Slack instead of a comparison-specific image, unlike blog posts which already have the per-page OG pipeline built.

#### `ux:39` — Battle-card PDF footer uses a raw ISO-8601 UTC timestamp, not en-US format

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - mcp-output/pdf-page-1.png
  - mcp-output/pdf-page-2.png
- **Impact:** The exported battle-card PDF headers itself correctly ('Battle card · August 30, 2026' on page 1), but the footer on page 2 reads 'Generated by Outrival · 2026-08-30T10:40:09.829Z' — a raw machine timestamp inconsistent with the page's own header and the project's en-US date rule for exports. This is the artifact a rep hands to a prospect, and the one piece of copy in the file that breaks the English/US-locale promise.

#### `ux:40` — Pricing/comparison table row labels fail color-contrast in dark theme

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - results.json /pricing laptop dark axe: {id: color-contrast, impact: serious, nodes: 8, sample: th[scope=row]}
  - results.json /vs/crayon, /vs/klue, /vs/diy, /alternatives/* laptop dark: color-contrast violation on each
- **Impact:** Comparison-table row labels fail minimum contrast in dark theme on exactly the rows carrying the pricing argument.

#### `ux:41` — Stale ?focus=<id> deep links silently reassign to an unrelated signal

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - A stale/invalid focus id (?focus=00000000-0000-0000-0000-000000000000) is silently swapped via router.replace to a different real signal id with no 'signal not found' message
  - URL also drifted on its own (twice) while simply reading the page, with no user interaction
  - A currently-valid, untouched signal id loaded correctly without reassignment, so only stale/invalid/already-actioned links are affected
  - adversarial-log.md, Section 2
- **Impact:** A user following an old digest-email deep link to a specific signal that's since been read/actioned lands on an unrelated signal with zero explanation that it isn't the one they clicked.

#### `ux:53` — Title Case <title> vs sentence-case <h1> on the same page (6 routes)

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - results.json: /vs/diy title "Outrival vs Doing It Yourself: DIY Competitor Tracking (2026)" vs h1 "Outrival vs doing it yourself"
  - /alternatives/crayon, /alternatives/klue, /alternatives/best-competitive-intelligence-tools show the identical pattern
  - /security title "Security & Trust | Outrival" vs h1 "Security & trust"
  - /status title "System Status | Outrival" vs h1 "System status"
  - /pricing title "Outrival Pricing: Competitive Intelligence from €0 / month" vs h1 "Competitive intelligence, priced in public."
- **Impact:** Six routes render a Title Case SEO <title> next to a sentence-case on-page <h1> for what is otherwise the same heading, while legal-document pages keep Title Case in both places — no single capitalization convention applied consistently.

#### `ux:61` — /docs is a near-empty 'coming soon' stub that's still indexed and sitemapped

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `misc` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - results.json: path=/docs, title="API (coming soon) | Outrival", textLength=1205
  - raw HTML: meta description "The Outrival API is in development and not yet available.", <meta name="robots" content="index, follow">, present in sitemap.xml
- **Impact:** A page whose entire content is 'not yet available' is indexable and sitemap-listed, so it can rank and disappoint a searcher, contributing a thin-content signal against an otherwise well-built site.
- **Corrected by the refuter (kept, not overridden):** The page is not truly empty — it has real copy (feature description) and a working mailto: lead-capture CTA, and its indexability survives the site's own deliberate, hand-curated sitemap.ts (which explicitly names and prunes 7 low-value legal pages but keeps /docs). The codebase has a working robots:{index:false} pattern used elsewhere (admin, dev/preview, onboarding, auth, brief/[id]) that was simply not applied here. So this reads as an easy, low-priority SEO cleanup rather than evidence of neglect on an 'otherwise well-built site' — the 'thin-content signal' and 'disappoint a searcher' framing overstates a page that functions as an intentional pre-launch waitlist stub.

#### `ux:07` — Products (portfolio view) page is orphaned from the sidebar

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_products__laptop__light` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard_products__laptop__light.jpg
  - shots/dashboard_settings_products__laptop__light.jpg ('open it in Products' text link, the only found path to /dashboard/products)
- **Impact:** /dashboard/products has no sidebar item under MONITOR/ANALYZE/MANAGE. The single discovered path in is a small text link inside Settings > Products, itself two clicks deep; a new user has no direct route from the dashboard root to manage which products they track.
- **Corrected by the refuter (kept, not overridden):** Products is present in the sidebar's Manage group and is not plan-gated, but on a real account with several competitors tracked, the default-expanded Competitors sublist (up to 8 rows + a toggle) pushes Products and Discovery below the fold on common viewport heights; reaching them requires scrolling the sidebar rather than being immediately visible. This is a real but milder issue than 'no sidebar item exists' — it's a default-state visibility problem, not a missing nav entry, and it is scrollable rather than a hard dead-end.

#### `ux:11` — Two different pages are both titled "Products"

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_products__laptop__light` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard_products__laptop__light.jpg (h1 'Products', columns: Competitors/Activity/Entry price)
  - shots/dashboard_settings_products__laptop__light.jpg (h1 'Products', rename/primary/remove UI)
- **Impact:** /dashboard/products (a read/activity view) and /dashboard/settings/products (a management view) carry the identical label but do different jobs, cross-linked only one way. A user asked to 'find Products' has no way to know which of two same-named pages, or that both exist.
- **Corrected by the refuter (kept, not overridden):** The duplicate-title confusion is real and verified — a user told to 'find Products' genuinely can't tell which of two identically-titled pages is meant. But the finding overstates isolation: the two pages link to each other both ways (a prominent 'Manage products' button on the portfolio page, and an 'open it in Products' link on the settings page), so this is a naming/labeling problem, not a discoverability/navigation-gap problem.

#### `ux:10` — Nonexistent competitor id renders a blank main panel, no error state

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/competitors/:id` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - Navigated to /dashboard/competitors/00000000-0000-0000-0000-000000000000
  - Sidebar/topbar chrome renders; <main> content area is empty below the toolbar
  - Console: GET /api/competitors/00000000-... -> 404, fired 4 identical times
  - Contrast: the equivalent /dashboard/products/<bad-id> route DOES show a proper 'Product not found' state
  - /home/tmfzi/.outrival-audit/2026-08-16/adversarial-log.md, Section 4
- **Impact:** A stale bookmark, old digest-email link, or mistyped id lands the user on a page that looks broken rather than telling them the competitor doesn't exist. The product-detail route one path over handles the identical failure class correctly, so the fix pattern already exists in the codebase.

#### `ux:18` — Em-dash in competitor content-change copy

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/competitors/:id` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - /dashboard/competitors/20dae913-0d5f-41e3-be2e-c9d8574620c8 — screenshot dashboard_competitors_20dae913-0d5f-41e3-be2e-c9d8574620c8__laptop__dark.jpg, 'What you know now' timeline: "The Miasma worm's path of destruction — 2026-06-07" and "Trust your software supply chain from ingestion to production — 2026-08-17"
- **Impact:** Violates the explicit no-em-dash rule. The pattern '<content title> — <date>' is the template used for every timeline/change entry on every competitor overview page, so it's almost certainly repeated across the other 14 tracked competitors' full change histories.
- **Corrected by the refuter (kept, not overridden):** Not a generic 'timeline template' issue: the same screenshot's Hiring entry ('11 jobs → 12 jobs') has no em dash, and the React renderer (MemoryTimeline in apps/web/src/components/dashboard/digest-view.tsx) itself never inserts one — dates render on a separate line via a relative 'X ago' string. The em dash is baked in only for CONTENT/blog-category facts, where the title+publish-date string is pre-built with ' — ' by blog.scraper.ts before it ever reaches the UI. Blast radius is every blog-tracked competitor's content-change entries, not 'every timeline/change entry' on every competitor page.

#### `ux:12` — Sector trends is a separate, unlisted feature that collides in name with the sidebar's Trends

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_trends__laptop__light` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard_trends__laptop__light.jpg (sidebar 'Trends': pricing/hiring/review numeric trends)
  - shots/dashboard_sector__laptop__light.jpg (h1 'Sector trends', own tabs: All/Features/Hiring/Pricing/Positioning/Emerging, no sidebar entry)
- **Impact:** /dashboard/sector is a first-class ANALYZE-shaped feature with its own tab set, yet is absent from the sidebar entirely. Because the sidebar's 'Trends' item covers a related but different job, a user who finds Trends has no signal a second, differently-scoped trends page exists — it is reachable only by URL.

#### `ux:50` — Trends page's Reviews section overclaims stability from a single data point

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_trends__laptop__light` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard_trends__laptop__light.jpg
- **Impact:** The headline states 'Every score we track held within a tenth of a point,' but the chart and table beneath show exactly one competitor with review data (Cosyra, 4.7/5, 13 reviews, flat) — a stability claim phrased as surveying 'every score' is not falsifiable or meaningful with n=1.

#### `ux:19` — Em dash in live transactional email subject lines

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `packages/shared/src/email/lifecycle.ts` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/shared/src/email/lifecycle.ts:33
  - packages/shared/src/email/lifecycle.ts:60
  - apps/workers/src/core/generate-weekly-digest.ts:284
  - apps/workers/src/core/generate-weekly-digest.ts:534
  - apps/workers/src/core/generate-daily-digest.ts:222
- **Impact:** Every welcome email, first-change celebration, and weekly/daily digest shows an em dash in the subject line sitting in a real customer's inbox — a direct, repeated violation of the no-em-dash rule on the highest-visibility surface the product has.

#### `ux:45` — Welcome, celebration and monthly-recap emails have no unsubscribe path

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `packages/shared/src/email/lifecycle.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - packages/shared/src/email/lifecycle.ts (renderWelcomeEmail/renderCelebrationEmail/renderMonthlyRecapEmail signatures take no unsubscribeUrl)
  - packages/shared/src/email/digest.ts:165 (renderDigestEmail's unsubscribeUrl param, for contrast)
- **Impact:** Weekly/daily digests ship a working one-click unsubscribe (List-Unsubscribe header plus signed-token footer link), but the D0 welcome, first-change celebration, and monthly-recap-teaser sends carry neither, so a user who only wants to stop the periodic recap has no in-email way to do it.

#### `ux:32` — Editing a Settings field and clicking away silently discards it

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/settings/general` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - Edited the Workspace name field on /dashboard/settings/general (no save), then clicked the 'Profile' sidebar link (client-side Next.js nav)
  - Navigation completed instantly, edit discarded, no confirm dialog, no beforeunload-style guard
  - adversarial-log.md, Section 2
- **Impact:** Any unsaved edit anywhere in Settings is one accidental sidebar click away from silent data loss, with no recovery path.

#### `ux:25` — Filter-tab bars use Radix Tabs without TabsContent, leaving aria-controls dangling

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/app/dashboard/discovery/discovery-view.ts` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/app/dashboard/discovery/discovery-view.tsx:1259-1278 (imports Tabs/TabsList/TabsTrigger, never TabsContent)
  - apps/web/src/components/dashboard/signals-list-header.tsx:411 (same pattern)
  - apps/web/src/components/dashboard/sectoral-feed.tsx:173 (same pattern)
  - axe rule 'aria-valid-attr-value' (critical): 12 nodes across /dashboard/signals, /dashboard/discovery, /dashboard/sector
- **Impact:** All three filter-tab bars reuse Radix's full Tabs primitive purely as a segmented filter but never render TabsContent, so each trigger's auto-generated aria-controls references a nonexistent DOM id. Assistive tech gets a broken relationship on every filter tab in the app's three busiest list views.

#### `ux:58` — Discovery candidate row nests real buttons inside a role=button wrapper

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/app/dashboard/discovery/discovery-view.ts` · severity `minor`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/app/dashboard/discovery/discovery-view.tsx:444-446 (role="button" row)
  - apps/web/src/app/dashboard/discovery/discovery-view.tsx:508 (nested Delete button)
  - apps/web/src/app/dashboard/discovery/discovery-view.tsx:547 (nested Dismiss button)
  - results.json: /dashboard/discovery laptop+mobile, both themes -> axe nested-interactive (serious) and aria-valid-attr-value (critical)
- **Impact:** CandidateRow wraps the whole row in <div role="button" tabIndex={0} aria-expanded={open}> and renders Track/Dismiss/Delete <Button> elements inside it — confirmed on every laptop/mobile capture as 'Interactive controls must not be nested' plus an invalid aria-attribute value, i.e. nested controls fighting over the same click/Enter target.
- **Corrected by the refuter (kept, not overridden):** Nested-interactive violation on CandidateRow (role=button wrapping Track/Dismiss/Delete buttons) is real and confirmed on /dashboard/discovery laptop+mobile, both themes. Drop the 'aria-valid-attr-value' half of the impact claim: that single flagged node on this route is the Tabs trigger's dangling aria-controls, already reported under ux:25, not a second attribute defect on this row.

#### `ux:26` — Signal/digest reasoning is a single template stamped onto every event, including noise

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_digests_in-progress__laptop__light` · severity `major`
- **Effort:** `L` · **fix risk:** `medium`
- **Proof:**
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/dashboard_digests_in-progress__laptop__light.jpg
- **Impact:** Every bullet in the in-progress digest follows the identical shape, applied indiscriminately even to trivial scrape noise (e.g. a job-count changing from 3,311 to 3,354). A user skimming the week's brief sees confident-sounding differentiation advice manufactured from single-digit fluctuations, reading as machine-generated filler rather than analysis.
- **Corrected by the refuter (kept, not overridden):** The finding's own cited example ('a job-count changing from 3,311 to 3,354') is not 'single-digit fluctuations' as stated — it's a 43-count / ~1.3% change. A genuinely single-digit example does exist on the same screenshot (Cloudsmith 11→12 jobs), so the general critique (uniform confident narration regardless of actual materiality) holds, but the specific magnitude claim attached to the cited example is inflated.

#### `ux:00` — React error #418 hydration mismatch blanks core dashboard pages on near-every load

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/trends` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - results.json hydration field, 'Minified React error #418': /dashboard/trends 8/8 viewport×theme records, /dashboard/competitors/20dae913-0d5f-41e3-be2e-c9d8574620c8 8/8, /dashboard/activity 7/8, /dashboard/products/f737222e-2298-4ee4-9d5a-b641a62e0860 7/8, /dashboard/products/ab8d8685-fc5a-4342-8bb8-f626cf301bdc 7/8, /dashboard/digests/294a191b-5a86-477b-8417-c7c85eb6f3f3 7/8, /dashboard/digests/faa5adcb-4e97-48fe-92a5-648814fe8a83 6/8
  - /home/tmfzi/.outrival-audit/2026-08-16/mcp-output/console-2026-08-30T10-33-02-564Z.log + page-2026-08-30T10-33-03-123Z.yml: live repro on the digest/brief page shows the entire main content region empty (no heading, no cards), not just a first-paint flash
  - /home/tmfzi/.outrival-audit/2026-08-16/mcp-output/console-2026-08-30T10-14-20-386Z.log + page-2026-08-30T10-14-21-070Z.yml: second live repro, same page
  - Lines up with the project's known unguarded isToday()/date-fns SSR-mismatch pattern
- **Impact:** Server-rendered markup doesn't match React's first client render, so React discards and redraws that subtree right after paint, on the pages a returning user hits most (trends, activity, digests, competitor/product detail). Reproduces on 6-8 of every 8 sampled viewport/theme combos per route (deterministic, near-every-load); live reproduction confirms the worst case is not a flash but a fully blank main content area with no error message.
- **Corrected by the refuter (kept, not overridden):** The React error #418 frequency claim is fully verified via results.json (exact match: 8/8, 8/8, 7/8, 7/8, 7/8, 7/8, 6/8 for the 7 listed routes) — that part of the finding is solid. But the 'live reproduction confirms the worst case is... a fully blank main content area, not just a flash' claim overreaches its own cited evidence: of the two repro pairs cited, only page-2026-08-30T10-33-03-123Z.yml actually shows a blank <main> (toolbar buttons only, no heading, no cards). The other one cited as 'second live repro, same page' — page-2026-08-30T10-14-21-070Z.yml, paired with console-2026-08-30T10-14-20-386Z.log which logs the identical error — instead shows the digest page fully rendered: 'heading "Opportunity: Competitors are shifting focus toward AI and security..." [level=1]', article cards, everything present. So the same console error occurred in both captures, but only one of the two produced a blank page. The hydration mismatch itself is real and frequent; 'reliably blanks the page' is not established — in the one clean comparison available it self-healed to a complete render.

#### `ux:02` — Battle cards library has no entry point anywhere in the nav

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard__laptop__light` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard__laptop__light.jpg (sidebar: MONITOR/ANALYZE/MANAGE groups, no 'Battle cards')
  - shots/dashboard_battle-cards__laptop__light.jpg
  - shots/dashboard_competitors_279cf1d7-fe7a-4f08-80be-eccfffb6e054__laptop__light.jpg (competitor detail has 'Generate battle card' but no link back to the library)
- **Impact:** The aggregate /dashboard/battle-cards page is reachable only by typing the URL; the sidebar has no item for it and neither the Competitors list nor a competitor detail page links to it. It also renders '0 cards across your products' even though 3 per-competitor battle cards exist in the crawl, so a user who stumbles onto it via URL sees a false empty state.
- **Corrected by the refuter (kept, not overridden):** The 'no nav entry point' half of this finding duplicates docs/page-audit-2026-06-30.md, which already flagged this exact issue: 'Battle-cards | PROMOTE | Klue/Crayon are built around battlecards; here it's orphaned from the nav (reachable only via an Overview block or Cmd-K). Either give it a real home or accept it lives on competitor-detail — but stop shipping a category-defining asset as a hidden index.' Per the audit's own duplicate rule that part should carry no new weight. What is new and independently verified here — and not mentioned in the prior audit — is the false-empty-state data bug: /dashboard/battle-cards reports '0 cards across your products' while 3 distinct per-competitor battle-card pages actually exist in the crawl (competitor ids 279cf1d7, 20dae913, 3f9c28e8, each with a /battle-card sub-route captured at every viewport/theme). That's a genuine scoping/fetch bug on top of the already-known IA gap, and is the part worth tracking.

#### `ux:03` — No custom not-found.tsx: dead/mistyped routes fall through to Next's bare, chromeless 404

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/app/dashboard/settings/members/page.ts` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - find apps/web/src -iname 'not-found*' -> no results
  - apps/web/src/app/dashboard/settings/members/page.tsx (calls notFound() when FEATURE_FLAGS.multiUser is off)
  - results.json record: path=/dashboard/settings/members, status=200, title='404: This page could not be found.', bodyStart='Skip to content\n404\nThis page could not be found.' (no sidebar, no nav, no CTA)
  - shots/dashboard_settings_members__laptop__light.jpg
  - 'Members' is not even present in the Settings nav (visible in the general screenshot)
- **Impact:** Every other failure surface in the app (dashboard/error.tsx, ListError, PartialError, SettingsError, even Battle cards' empty state) keeps the sidebar/topbar and a designed card; a dead/mistyped dashboard URL instead drops all app chrome for Next.js's generic unbranded placeholder with zero navigation back into the app. The one live instance in the crawl (a flag-gated settings route) confirms this ships today, and it can hit any dead route, not just this one.

#### `ux:04` — Form saves fail with zero user-visible feedback (systemic)

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/settings/workspace` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - Add-competitor dialog: empty submit and invalid-URL submit both leave the dialog open with no error text, no aria-invalid, no network request (client-blocked silently)
  - Settings > General > Workspace name: pasted 5000 chars, clicked Save changes; PATCH /api/settings/workspace returned 400 with body {"error":"Invalid body","issues":[{"code":"too_big","path":["name"],"message":"Too big: expected string to have <=100 characters"}]}; UI showed nothing (no toast, no inline error) and the 'Unsaved changes' bar just persisted
  - /home/tmfzi/.outrival-audit/2026-08-16/adversarial-log.md, Section 1
- **Impact:** Users hit an invisible wall on any invalid submission, whether blocked client-side or rejected by a backend that actually has a good, descriptive error message. Confirmed on two independent forms, suggesting a shared pattern (e.g. a toast/error-surfacing layer not wired to these save paths) rather than a one-off.

#### `ux:05` — Privacy Policy's retention window and Subprocessors' storage claim for the demo/contact form don't match the code

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/api/src/routes/contact.ts` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/api/src/routes/contact.ts:78 (`await sendDemoRequestEmail(req)` — no database write for the submission)
  - apps/api/src/lib/contact-email.ts (renders the submission into an HTML email sent via Resend to hello@outrival.app; nothing persisted)
  - apps/web/src/lib/legal/entity.ts:123-128 (Neon subprocessor entry lists 'contact-form data' among what it processes)
  - shots/privacy__laptop__light.jpg (retention table row 'Demo / contact form … Up to 3 years from last contact')
  - apps/workers/src/core/purge-retention.ts (the only retention-purge job; scoped to org tables — signals, snapshots, notifications, analytics history — never touches contact-form data because none exists in Postgres)
- **Impact:** The stated 3-year deletion window has no enforcing code, because the data is never stored in the database the Subprocessors page says handles it — it lives on indefinitely in an email; a data-subject erasure request can't actually be served from where the site says the data lives.

#### `ux:06` — Quick-add and toolbar inputs rely on placeholder alone, no accessible name

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/dashboard/competitors-list.ts` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/dashboard/competitors-list.tsx:543
  - apps/web/src/app/dashboard/products/my-product-view.tsx:508-511
  - apps/web/src/app/dashboard/products/my-product-view.tsx:540-545
  - apps/web/src/components/outrival/self-change-review.tsx:551-557
  - apps/web/src/components/dashboard/signal-comments.tsx:294,253,346 (shared Composer defined 494-548)
  - apps/web/src/components/dashboard/ask-panel.tsx:524-532
- **Impact:** The competitors-list search box, the product page's 'enable monitoring' URL inputs, the tag input, the comment/reply/edit Composer used on every signal, and the Ask Outrival box all render inputs with only a placeholder and no Label/aria-label. A screen-reader user tabbing to any of these hears an unnamed field, and the visible hint disappears once typing starts.

#### `ux:14` — Site-wide color-contrast (WCAG AA) failures across 73+ routes, both themes — contradicts the site's own accessibility claim

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/landing/compare/glance-table.ts` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - results.json axe rule 'color-contrast': 1345 nodes total, 73 routes, dark theme 639 nodes / light theme 706 nodes
  - apps/web/src/components/landing/compare/glance-table.tsx:46-47 (text-primary on highlighted row, unconditional of background)
  - apps/web/src/components/landing/pricing-page.tsx:115-118 (identical pattern on <th scope=row>)
  - shots/alternatives_best-competitive-intelligence-tools__laptop__light.jpg (the 'Outrival' row)
  - failures.json — axe id 'color-contrast', impact 'serious', sample '.text-primary', present on /privacy, /terms, /terms-of-sale, /security, /accessibility, /bot, /legal, /legal-notice, /dpa, /subprocessors, both themes, both viewports (226 records)
  - apps/web/src/app/accessibility/page.tsx:40-43 ('We build with semantic HTML, keyboard support, theme-aware contrast and focus states')
  - results.json: /blog/how-outrival-scraping-pipeline-works laptop dark axe color-contrast nodes=14 (code[data-language="json"] > span...) vs light nodes=4; shots/blog_how-outrival-scraping-pipeline-works__laptop__dark.jpg vs ...light.jpg
- **Impact:** The same theme-blind text-color pattern repeats across marketing comparison tables (the rows meant to sell the product on pricing/vs/alternatives), every legal/trust page, dashboard widgets, and blog code samples in dark mode. It directly contradicts the public /accessibility page's own claim of 'theme-aware contrast and focus states' — on the very page making that claim.
- **Corrected by the refuter (kept, not overridden):** The site-wide count (results.json: color-contrast, 1345 nodes across 73 routes, dark 639 / light 706) and the `.text-primary`-on-tinted-background pattern in glance-table.tsx and pricing-page.tsx are verified exactly as claimed. Two things in the evidence don't hold up, though: (1) the '226 records' figure for the ten legal/trust pages doesn't reconcile with the data — filtering failures.json to those exact paths + sample '.text-primary' + impact 'serious' gives 40 node-records (64 if the match is loosened to any '.text-primary*' sample across all 16 routes that have it), not 226. (2) the accessibility page's 'contradiction' is overstated: the same page, right after the 'theme-aware contrast' line, states it is in 'partial conformity', has 'not yet completed a full independent audit', and explicitly names 'comparison tables' under 'Known limitations' as a likely gap — so the page already discloses this class of issue rather than only claiming compliance.

#### `ux:15` — GDPR and security-report response commitments point at inboxes the code marks as not yet provisioned

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/lib/legal/entity.ts` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/lib/legal/entity.ts:43-49 (`general` commented 'Live inbox used across the site today'; `privacy` and `security` each commented 'TODO: provision this inbox (recommended)')
  - apps/web/src/app/security/page.tsx:97-101 ('email privacy@outrival.app … We respond within one month')
  - apps/web/src/app/security/page.tsx:181-186 ('email security@outrival.app … We read every report and will acknowledge yours')
  - repo-wide grep found privacy@outrival.app and security@outrival.app referenced nowhere outside this one constants file — no DNS/forwarding/mail config sets them up
- **Impact:** Two public, SLA-shaped promises (one-month GDPR response, 'we read every report') are staked on mailboxes the codebase's own source of truth distinguishes from the one confirmed-live address — a commitment that reads as nobody's confirmed job to keep.

#### `ux:16` — Competitor table truncates the core content column instead of adapting

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_competitors__tablet__light` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - shots/dashboard_competitors__tablet__light.jpg
  - shots/dashboard_competitors__mobile__dark.jpg
- **Impact:** The Competitors list keeps a fixed multi-column table at both mobile and tablet widths; the 'Latest move' column, which carries the actual signal text, is ellipsis-truncated on every row instead of reflowing to a stacked/card layout — hiding the product's core value on the most-visited list page at every non-desktop width.

#### `ux:17` — Generated "What changed" section ships blank on a live signal

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_signals__laptop__light` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - /home/tmfzi/.outrival-audit/2026-08-16/shots/dashboard_signals__laptop__light.jpg
- **Impact:** The Cosyra "pricing page" signal renders a completely empty box under "What changed", the section meant to state the factual diff before the AI's reasoning. A user gets an unsupported opinion with no stated evidence. Confirmed not a rendering artifact: the dark-theme capture of the same route shows a different signal's "What changed" fully populated, so the AI pipeline itself left this one empty.

#### `ux:20` — /dashboard/sector filter row overflows the mobile viewport by 46px

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/sector` · severity `major`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - failures.json: path=/dashboard/sector, viewport=mobile, overflowPx=46 (both themes)
  - shots/dashboard_sector__mobile__light.jpg
  - results.json bodyStart: '...Patterns across your competitors...\nAll\nFeatures\nHiring\nPricing\nPositioning\nEmerging\n...'
- **Impact:** The category pill row is not wrapped or given a horizontal-scroll container, so it pushes the whole document 46px past the 390px mobile viewport; the last pill ('Emerging') sits flush against the screen edge.

#### `ux:22` — Cap or defer the Vanta/Three.js fog canvas on marketing pages

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/landing/vanta-fog.ts` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - results.json: / avg ms=10291, max=24529 (n=8); /demo avg=10021, max=19116; /pricing avg=5616, max=8576; /vs/klue avg=5438; /docs avg=5566; /status avg=5299
  - apps/web/src/components/landing/vanta-fog.tsx:11-64 (lazy-imports three + vanta.fog.min, builds a full-hero WebGL canvas on mount)
  - apps/web/src/components/landing/compare/compare-shell.tsx:67-87 (PageHero mounts <VantaFog/> unconditionally; 21 call sites incl. pricing, every /vs/*, every /alternatives/*, /demo, /sample, /docs, /status, /blog, /blog/[slug])
  - results.json consoleErrors unique to '/' and '/pricing': 'GPU stall due to ReadPixels' x4, 'THREE.Clock: This module has been deprecated' x16, 'No available adapters' x7
  - shots/home__desktop__dark.jpg, shots/pricing__laptop__dark.jpg, shots/status__desktop__dark.jpg, shots/docs__desktop__light.jpg
- **Impact:** The public route group averages 5107ms vs 1787ms for the authenticated app, and every one of the 10 slowest routes is a public page mounting this canvas, including a stub 'coming soon' page and the plain status page. Cost tracks viewport pixel count (desktop/laptop 3606-3612ms vs mobile/tablet 2348-2398ms). Content paints complete and stays put (overflowPx 0, stable textLength) — the animation just keeps the tab busy for several extra seconds, worst on desktop.

#### `ux:27` — Time-to-first-signal is an explicitly probabilistic SLO, not a bounded promise

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `packages/shared/src/slo/first-signal.ts` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - packages/shared/src/slo/first-signal.ts:8-12 (70% target over 28d, 50% week-degraded floor, pages only after 3 consecutive misses)
  - apps/workers/src/core/backfill-history.ts:29-41 (Wayback-archive backfill is best-effort, 'silent skip' on failure)
  - apps/workers/src/core/notify-onboarding-analysis.ts:24-28,99-106 (8-minute wait then notifies with softer copy regardless of completion)
- **Impact:** The org's own compliance target accepts up to 30% of onboardings missing the 10-minute first-signal mark over a rolling 28 days; a meaningful minority of new users can reach the dashboard with an empty Signals feed and no client-side explanation, since day-0 archive backfill fails silently when no Wayback snapshot exists.
- **Corrected by the refuter (kept, not overridden):** Downgrade from major to minor: the SLO is an intentional, documented compliance target (not a bug), and onboarding completion already sends an in-app notification even on partial/slow analysis. The only legitimate, narrow gap is that the Signals feed's cold-start EmptyState text is generic and doesn't distinguish 'still analyzing' from 'nothing added yet' — worth a copy tweak, not a major severity finding.

#### `ux:28` — Signals feed listbox is missing role=option children

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/dashboard/signals-view.ts` · severity `major`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/components/dashboard/signals-view.tsx:1405-1409
  - route /dashboard/signals, axe rule 'aria-required-children' (critical): 4 nodes
- **Impact:** The main signals feed wraps rows in <div role="listbox" aria-label="Signals">, but children don't carry role=option, so screen-reader users lose list/position announcements ('item 3 of 47') on the app's primary feed.
- **Corrected by the refuter (kept, not overridden):** Slightly more precise than stated: it's not that role=option is entirely absent from the code, but that it's obscured two levels deep behind a role="presentation" wrapper div, which is what breaks the automated (and likely AT) parent-child relationship. Practical effect for screen-reader users is the same as claimed.

#### `ux:29` — Settings has no Team/Members page; guessed URLs 404 with no chrome

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard_settings__laptop__light` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - shots/dashboard_settings__laptop__light.jpg (sidebar: PERSONAL Profile/Notifications/Security, WORKSPACE General/Products/Subscription/Usage/Integrations/API keys/Data — no Members)
  - results.json: path=/dashboard/settings/members, title='404: This page could not be found.', status=200
  - mcp-output/page-2026-08-30T10-16-40-606Z.yml (/dashboard/settings/team) + console-2026-08-30T10-16-40-458Z.log
  - mcp-output/page-2026-08-30T10-28-01-144Z.yml (/dashboard/competitors/<id>/pricing) + console-2026-08-30T10-28-00-988Z.log
- **Impact:** Team-member management, an expected job for a Pro-plan workspace, has no entry point anywhere in Settings and no sidebar item; every plausible guess at its URL (/settings/team, /settings/members) as well as an unrelated guessed sub-route (/competitors/<id>/pricing) 404 to Next.js's bare default page — no sidebar, topbar, or link back — a genuine dead end for anyone who bookmarks, shares, or guesses a dashboard URL.
- **Corrected by the refuter (kept, not overridden):** Slightly broader than stated: the bare-404 problem isn't dashboard-specific, it's app-wide (no not-found.tsx anywhere), so any mistyped/guessed URL app-wide hits the same chrome-less page, not just the three dashboard URLs listed.

#### `ux:30` — Marketing nav's get-session call is unconditional and gets itself rate-limited

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/landing/nav.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - apps/web/src/components/landing/nav.tsx:53-70 (Nav calls useSession() unconditionally on every landing/marketing/app render, purely to swap 'Sign in' for 'Go to dashboard')
  - results.json httpErrors: GET https://api.outrival.app/api/auth/get-session returned 429 fifty-eight times across 640 records, spanning 20+ distinct public paths (/pricing, /about, /, /demo, /blog, /docs, /status, /changelog, /bot, /sample, /legal-notice, /privacy, /terms, ...)
  - python scan of results.json: 26/88 landing-page records (5 routes + vs/alternatives, all viewport×theme) carry a 429 on get-session
  - results.json: /vs/diy desktop/dark shows nav text 'Go to dashboard' while /vs/crayon and /vs/klue in the same crawl pass show 'Sign in'
- **Impact:** A fetch that exists only to toggle two nav links runs on every anonymous view of every public/legal page and is cheap enough to trip its own rate limit under nothing more than a sequential crawl; a real burst (shared office IP, link-preview bot, a few tabs) will see it fail routinely in prod, and the visible symptom is the nav flickering between 'Sign in' and 'Go to dashboard' on the same route across a crawl. Currently non-blocking (SSR fallback shows the signed-out CTA correctly), but the single most-throttled request in the whole crawl for near-zero functional gain.

#### `ux:31` — Marketing comparison tables aren't keyboard-focusable and crop content on mobile

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/landing/compare/compare-table.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/landing/compare/compare-table.tsx:64 ('overflow-x-auto' div, no tabIndex)
  - axe rule 'scrollable-region-focusable': 18 nodes, mobile-only, 9 routes (/, /pricing, /bot, /vs/crayon, /vs/klue, /vs/diy, /alternatives/*)
  - results.json /pricing mobile dark axe: {id: scrollable-region-focusable, impact: serious, sample: .lp-hot-table}, recurs on 10+ sampled records via .lp-ctx-wrap
  - shots/pricing__mobile__dark.jpg (Klue column cropped out of frame, no visible scroll affordance)
- **Impact:** The 'Outrival vs Crayon vs Klue' cost table and every /vs and /alternatives feature table are horizontally-scrolling divs with no keyboard focus; on mobile the pricing table's Klue column is cropped out of frame with no visible scroll affordance, so a keyboard-only user can't pan to reach cut-off columns and a phone visitor may only see 2 of 3 vendors in the page's own headline argument.

#### `ux:33` — Trends slope chart emits invalid SVG points, causing a hydration error

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/dashboard/trends-slope-chart.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/dashboard/trends-slope-chart.tsx:60-62,171 — X_TO="88%" etc. interpolated directly into points={`${X_TO},${leader.endY} ...`}
  - failures.json /dashboard/trends (all 8 viewport x theme records): console error 'Error: <polyline> attribute points: Expected number, "88%,..."' and pageError 'Minified React error #418' (hydration mismatch)
  - failures.json /dashboard/activity: same React #418 hydration error on all records
- **Impact:** Fires on the populated-data path on every viewport and theme, so the leader-line annotation on the pricing slopegraph is silently dropped by the browser for real users, not just an edge case.

#### `ux:34` — Inline prose links (pricing footnotes, FAQ mailto) distinguished by color alone

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `compare-faq.tsx` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - axe rule 'link-in-text-block': 44 nodes, 9 routes, worst on /pricing (12 nodes)
  - samples '.hover\:underline.text-primary[href$="crayon"]' and '.text-link' inside compare-faq.tsx's lp-faq-lead mailto link
  - results.json / laptop dark axe: {id: link-in-text-block, sample: .lp-faq-lead > a[href$=mailto:hello@outrival.app]}
  - results.json /vs/crayon, /vs/klue, /vs/diy, /alternatives/* laptop dark: link-in-text-block violation on each
- **Impact:** Text links (pricing page's 'Outrival vs Crayon' link, homepage FAQ's mailto link) are underlined only on hover, so colorblind or low-vision readers scanning static text can't tell they're links.

#### `ux:35` — Usage meters render as unnamed progressbars

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/outrival/usage-dashboard.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/outrival/usage-dashboard.tsx:83-86
  - axe rule 'aria-progressbar-name': 36 nodes, worst on /dashboard/settings/usage (24 nodes), also /notifications, /products, /billing settings
- **Impact:** Each usage row renders a <Progress> with no aria-label/aria-labelledby even though the dimension label sits in a visible sibling span; screen-reader users hear an unnamed 'progressbar NN%' with no way to tell which plan limit it refers to.

#### `ux:36` — Detection-settings group labels have no programmatic association with their controls

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/outrival/detection-config-sheet.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/outrival/detection-config-sheet.tsx:125
  - apps/web/src/components/outrival/detection-config-sheet.tsx:170
  - apps/web/src/components/outrival/detection-config-sheet.tsx:188
- **Impact:** <Label>Sensitivity</Label>, <Label>Cadence</Label> and <Label>Primary market</Label> sit as siblings of a ToggleGroup/Select rather than using htmlFor or wrapping the control, so the Label-to-control association never fires; tabbing into the ToggleGroup or Select trigger announces only the widget's current value, not which setting it controls.

#### `ux:38` — Watched Questions section disappears entirely when empty

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/dashboard/watched-questions.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/dashboard/watched-questions.tsx:83 — if (!queries || queries.length === 0) return null;
- **Impact:** A brand-new user on /dashboard/ask never sees the 'Watched questions' heading, its explanation, or any hint the feature exists — the whole section is absent rather than showing a defined empty state, so the feature is undiscoverable until the user already has a watched question.
- **Corrected by the refuter (kept, not overridden):** The 'Watched questions' list section does vanish (no heading, no defined empty state) for a new user on /dashboard/ask — a minor missing-empty-state polish issue. But the watch/discovery feature itself is not hidden: it's introduced via AskPanel's own 'Watch this question' button shown after any answer, so 'the feature is undiscoverable' is not accurate.

#### `ux:42` — Cookie-consent banner overlaps the first payoff content right after onboarding

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/onboarding__laptop__dark` · severity `minor`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - shots/onboarding__laptop__dark.jpg (consent banner overlays the 'Who moved' competitor-movement cards)
  - shots/auth__mobile__light.jpg (consent banner overlays the stats column directly below the first signal card)
- **Impact:** The fixed-position consent widget sits directly over the 'Who moved' summary cards on laptop and the stats column on mobile, competing with the flow's actual payoff for attention on the very first view a first-time user gets right after finishing onboarding.

#### `ux:46` — profile-settings-form.tsx can leak a raw Error.message to the user

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/outrival/profile-settings-form.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/web/src/components/outrival/profile-settings-form.tsx:204 — toast.error(err instanceof Error ? err.message : "Could not update profile")
  - apps/web/src/lib/error-helpers.ts:9 — "No stack trace, no technical detail ever reaches the user (patch-14)"
- **Impact:** If the catch block ever receives anything other than the curated Better Auth response error (a network TypeError, an unexpected exception), its raw .message string goes straight into the toast instead of through errorConfig — the one path in the audited error-handling code that can leak an internal message verbatim.

#### `ux:54` — French guillemets wrap quoted objections in the battle-card PDF

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/workers/src/lib/battle-card-html.ts` · severity `minor`
- **Effort:** `S` · **fix risk:** `low`
- **Proof:**
  - apps/workers/src/lib/battle-card-html.ts:30
- **Impact:** The 'Common objections' section of every generated battle-card PDF renders each objection as « objection » (French guillemets with French non-breaking-space convention) instead of English double quotes, the one non-English typographic detail in an otherwise correctly English (lang="en", en-US date) export.

#### `ux:55` — Topbar 'Refresh' is a full page reload and drops offline to the browser's own error page

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `/dashboard/competitors` · severity `minor`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - On an already-loaded /dashboard/competitors, set browser context offline, clicked topbar Refresh
  - Result: whole tab hard-navigated to Chromium's native chrome-error://chromewebdata/ 'No internet' interstitial, losing the entire dashboard shell
  - Recovered cleanly once back online (plain goto reloaded normally)
  - adversarial-log.md, Section 5
- **Impact:** Any connectivity blip during a Refresh click drops the user out of the app entirely instead of an in-app 'couldn't refresh, try again' state — worse than a typical SPA refetch failure. Edge case (requires connectivity drop at the exact click moment), keeping this minor despite the jarring result.
- **Corrected by the refuter (kept, not overridden):** The bug is real but is Next.js App Router's built-in fallback-to-hard-navigation on a failed background refresh while offline, not a developer choice to implement Refresh as a full page reload; the fix (if pursued) is catching the router.refresh() failure, not replacing an allegedly hard-coded navigation.

#### `ux:56` — 82 of the app's toast.error() calls bypass the documented error-toast contract

- **Status:** verified true · votes 1, against 0 · **confidence `high`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/outrival/crm-destinations.ts` · severity `minor`
- **Effort:** `L` · **fix risk:** `medium`
- **Proof:**
  - grep -rn "toast\.error(" apps/web/src --include=*.tsx | wc -l -> 82
  - grep -rl "toastApiError(" apps/web/src --include=*.tsx | wc -l -> 22
  - apps/web/src/components/outrival/crm-destinations.tsx:151 ("Test failed.", no explanation, no retry action)
  - apps/web/src/lib/error-helpers.ts:1-17 (documents the title/description/action contract this bypasses)
- **Impact:** lib/error-helpers.ts states the doctrine explicitly and 22 files follow it, but the majority of toast.error call sites show one generic hardcoded string with no retry affordance and no code-specific reason, so a rate limit, a network blip and a permission error can all read identically.

#### `ux:59` — Contrast tuned per-theme independently: competitor-timeline links fail only in light, blog code blocks fail only in dark

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/components/blog/mdx.ts` · severity `minor`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/app/dashboard/competitors/[id]/competitor-detail/what-changed.tsx:91 ('.text-link', 'self-end') — fails only in LIGHT theme, mobile, on 3 competitor-detail routes
  - apps/web/src/components/blog/mdx.tsx:11 (dual shiki themes github-light/github-dark) — dark-mode code-block tokens fail only in DARK theme on /blog/how-outrival-scraping-pipeline-works (28 nodes)
- **Impact:** Because the two themes were tuned independently, a QA pass in only one theme misses real failures in the other: blog dark-mode syntax highlighting and the competitor timeline's light-mode link are each broken in exactly one theme.

#### `ux:60` — Two unrelated 'first success' signals are tracked independently and can disagree

- **Status:** verified true · votes 1, against 0 · **confidence `medium`** (as claimed by the finding, never raised)
- **Where:** apps/web (product surface) · `apps/web/src/hooks/use-onboarding-streaming.ts` · severity `minor`
- **Effort:** `M` · **fix risk:** `medium`
- **Proof:**
  - apps/web/src/hooks/use-onboarding-streaming.ts:83-108 (dashboard panel keys off competitor.aiSummary, calls it 'first_signal_received')
  - apps/web/src/components/dashboard/onboarding-checklist.tsx:12-21,28 (separate checklist 'signal' step, explicitly passive, points at /dashboard/signals)
  - apps/workers/src/lib/slo-first-signal.ts:32-43 (org-level SLO instead queries the real signals table)
- **Impact:** The client-side streaming panel can show 'First analysis complete' (every competitor has an AI summary) while the Signals feed the checklist points to is still genuinely empty, because a competitor summary and an actual detected change are different backend concepts measured by different code paths with no shared state.

### 6.5 Pulled back into scope from the annex (2)

These two were filed under `tests`/`debt` but were contested and survived, so they
are reported here rather than in the annex.

#### `code:TES-77` — No test guards the timestamp-vs-timestamptz split across ~140 columns

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/ai-visibility.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/ai-visibility.ts:105 — the only column using timestamp(..., {withTimezone: true})
  - roughly 140 other timestamp(...) calls with no withTimezone
  - migrations.test.ts asserts columns exist by name only, never their data_type
- **Impact:** Given the project's own history of client-facing timezone bugs, an accidental withTimezone flip on a client-facing column during a future edit would change how postgres-js parses the value with no test able to catch it.

#### `code:DEB-48` — Partial-index predicate is a raw column-name string decoupled from the schema definition

- **Status:** verified true · votes 2, against 0 · **confidence `low`** (as claimed by the finding, never raised)
- **Where:** packages/db · `packages/db/src/schema/monitors.ts`
- **Effort:** `S` · **fix risk:** `high`
- **Proof:**
  - packages/db/src/schema/monitors.ts:272 — index("monitors_due_idx").on(t.nextRunAt).where(sql`is_active = true`) uses the literal string 'is_active' instead of t.isActive
- **Impact:** TypeScript can't catch a future rename of the isActive column against this predicate — drizzle-kit's diff wouldn't know to regenerate the index, silently producing a WHERE clause referencing a nonexistent or wrong column. No divergence has happened yet, so this is currently cosmetic.

## 7. Findings NOT put through refutation (70)

These are real observations from real agents, but **nobody tried to kill them.**
They never entered the phase-4 refutation loop, so they carry no vote and no
independent confirmation. They are marked `verified: false` in the JSON and must
not be read at the same level of confidence as section 6. Several of them are the
most operationally urgent things in this report anyway, which is exactly why the
distinction is kept explicit rather than blurred.

### 7.1 Gap sweep (57)

Produced by the capped gap-probe rounds, which chase what the per-file batches
could not see: production telemetry, cross-package causality, and whole route
families no batch owned. Each is a single probe agent's conclusion, unrefuted.

- `security` — POST /api/auth/sign-up/email creates a live account with zero HIBP check and none of the signup anti-abuse gates
- `correctness` — 402 (payment required) is not in shouldFailover's status list — it fails fast on the credit-exhausted provider instead of failing over, and never trips any breaker
- `observability` — recordFailure()/global breaker never sees the 402s, so the 150 AIUnavailableError:too_many_failures occurrences are a separate, older incident — no alert exists that says 'billing problem'
- `cross-reference-refutation` — DEB-03's provider-pool.ts:99-121 model-fallback disagreement is unrelated to the 402 storm — different status code, different failure shape
- `test-coverage` — No test exercises status 402 anywhere in the provider-pool test suite
- `correctness` — Competitor free-tier plans rank as the most expensive, inverting entitlement move direction/severity
- `duplication` — pct/signedPct duplicated verbatim across entitlement-diff.ts and price-tier-diff.ts
- `security-confirmation` — SEC-36 and SEC-23 remain unreachable: no call site forwards external data into enqueue payload/options
- `observability` — Top Sentry bucket ("select count(*) filter (", 621x) conflates ≥6 unrelated queries, not one
- `correctness` — detect-hiring-footprint's evaluateFreeze, not slo-first-signal.ts, is the best-matched top-bucket contributor
- `reliability` — slo-first-signal.ts's fail-open catch is real, but its query likely isn't the one dominating Sentry
- `reliability` — Competitors-select signature is real and unguarded, but its volume/timeline don't match its weekly cadence
- `infra` — No shared root cause (e.g. Neon pooler statement timeout) confirmable from repo + telemetry
- `error-handling` — 402 from a pooled provider skips failover entirely, propagates raw, fills the DLQ
- Sector-trends feed silently shows "No sector trends yet" on a real fetch failure
- Digest reader shows "Brief not found" on a genuine query error, not just a real 404
- In-progress digest reader shows "No week in progress" on a genuine query error
- `root-cause-diagnosis` — OUTRIVAL-WORKERS-1G is detect-hiring-footprint.ts's freeze query, not detect-salary-shifts.ts
- `root-cause-diagnosis` — Failure pattern (621 Sentry hits vs 10 dead-lettered jobs) is transient/infra, not a bad-parameter query
- `resilience-gap` — evaluateFreeze/evaluateDisclosure are the only un-guarded DB calls in these two jobs
- `config` — detect-hiring-footprint/detect-salary-shifts run on a tighter 60s expiry than most jobs
- `scope-clarification` — The two related, now-stopped Sentry issues are unrelated to hiring/salary detectors
- `correctness` — 402 (Cerebras insufficient credit) skips failover, breaker, and AI backoff entirely
- `observability` — No Slack/ops alert fired during the 11-day Cerebras 402 outage
- `ai-status-banner` — 402 billing outage always renders as self-healing 'degraded', never 'down' — banner copy is false
- `security-prompt-injection` — Prompt-injection attempt observed mid-task via forged 'PreToolUse:Read hook' text
- `reliability` — Three independent processes each open a max:10 pool against one Neon DATABASE_URL, with no fan-out accounting
- `reliability` — OUTRIVAL-WORKERS-1G and -T still firing daily as of the telemetry pull, zero code finding or fix
- `reliability` — OUTRIVAL-WORKERS-11/-S (competitors query) is not deploy-time schema skew — refutes that hypothesis, points to resource contention instead
- postgres.js default prepared statements vs Neon pooled endpoint — root cause of ~859 unexplained 'Failed query' errors/30d, uncovered by any board finding
- F10's unresolved recommendation is now a confirmed, live incident, not a restated theory
- apps/api shares the identical client.ts and is structurally exposed to the same mismatch, unconfirmed by telemetry
- isBaseline=0 with fromStatus=null is reachable on the mainline ingest path, not just a race
- content-items.ts has the same unvalidated raw/normalized pairing, one level down
- ALERT_FROM fallback reimplemented a third time in notifications.ts, bypassing the fixed sendEmail() entirely
- resend.ts logic itself duplicated verbatim between apps/api and apps/workers with no shared source
- notifications.ts email branch is NOT behaviorally identical to the fixed resend.ts pattern despite copying its fallback
- RESEND_FROM and RESEND_AUTH_FROM undocumented in .env.example, contradicting CLAUDE.md's own rule for the exact var that already caused OUTRIVAL-WORKERS-1D
- RESEND_AUTH_FROM fallback also duplicated between sign-in-email.ts and contact-email.ts
- GET /:id/jobs never returns isActive, but CompetitorJob.isActive is typed as required boolean
- GET /:id/positioning-history is dead code server-side; web client stopped calling it in commit e8b2599 (#431) but the route, its exported type, and its helper function were never removed
- RateStructures.plans[] web type omits the per-row capturedAt the API actually returns
- `cross-org-idor` — GET /api/feedback returns every org's feedback rows with no orgId filter
- `security` — SSE notification stream ignores suspension/session revocation for the life of the connection
- `resource-leak` — Ask agent has no server-side cancellation path — LLM calls run to completion after client disconnect, budget never reconciled
- `correctness` — SAFETY_MS timeout freezes onboarding-analysis panel forever with no error
- `reliability` — SSE reconnect storm on API restart: no retry directive, no client backoff, no server-side cap
- `reliability` — No global or per-user SSE connection cap, and no graceful-shutdown drain for the API's own streams
- redrive() confirmed to replay dead-lettered jobs with zero content dedup
- send-welcome-digest.ts has no in-body guard; redrive resends the welcome email
- send-monthly-recap.ts has the identical trigger-site-only pattern; redrive resends the recap email
- extract-pricing / extract-jobs / extract-reviews: 'non-idempotent' inserts protected only by call ORDER, not by a DB constraint
- backfill-history.ts: retryLimit:0 is a design invariant against non-idempotent archive inserts, and redrive is exactly the bypass
- Soft-deleted competitors and their entire dependency tree are retained forever
- `data-integrity` — Six documented-but-unenforced closed-set text columns; zero drift found today
- `cost-control` — bulk/refresh-summary lets one AI-cap tick buy up to 25x real completions; sibling endpoint closed this exact hole
- Manual-snapshot POST has no body-size or rate limit

### 7.2 Annex entries pulled back as misfiled (13)

`triage.mjs` routes `tests`/`debt`/`docs`/`dependencies`/`polish` to the annex
without refuting them. A classifier pass then flagged these 13 as **mis-filed**: their
own text asserts a live defect, not a missing test or a cleanup note. They were
pulled back out of the annex but arrived after the refutation batches were sealed,
so they are unrefuted too.

- `code:TES-01` [filed `tests`] — Migration journal test checks idx contiguity, never `when` monotonicity — the exact clock-skew defect is live in the repo today
  - Why it was pulled back: States the clock-skew defect "is live in the repo today" — an active bug, not a missing-test claim.
- `code:TES-46` [filed `tests`] — sameRootDomain's naive TLD split is untested and likely wrong for multi-part TLDs
  - Why it was pulled back: Says the TLD split is "likely wrong," asserting incorrect behavior, not just lack of coverage.
- `code:TES-51` [filed `tests`] — crm-destinations.ts: whole file untested, including a write that drops the org-scope filter
  - Why it was pulled back: "A write that drops the org-scope filter" describes a live tenant-isolation break.
- `code:TES-52` [filed `tests`] — feedback-quality.ts is untested; its DELETE has no ownership filter in the query itself
  - Why it was pulled back: "DELETE has no ownership filter in the query itself" is a concrete cross-tenant data-deletion risk.
- `code:TES-53` [filed `tests`] — monitor-alternatives.ts is untested and its tenant scoping is check-then-act, not WHERE-clause enforced
  - Why it was pulled back: "Check-then-act, not WHERE-clause enforced" asserts current tenant-scoping is not actually enforced.
- `code:DEB-03` [filed `debt`] — Provider-pool model fallback disagrees with itself, and the disagreement is now live
  - Why it was pulled back: "Disagrees with itself, and the disagreement is now live" claims an active production bug, not duplication to clean up.
- `code:DEB-12` [filed `debt`] — queue-admin.ts raw timestamps violate the package's own UTC-wrap invariant
  - Why it was pulled back: "Violate the package's own UTC-wrap invariant" asserts current output is wrong (incorrect timestamps), not a debt note.
- `code:DEB-14` [filed `debt`] — 4 tasks bypass the shared safeParseJson helper and lose markdown-fence stripping
  - Why it was pulled back: "Lose markdown-fence stripping" is a concrete claim that JSON parsing will fail for real model output, not a reuse nit.
- `code:DEB-25` [filed `debt`] — scrapeStatic's robots.txt refusal breaks the ScrapeFailedError/refused contract it documents
  - Why it was pulled back: "Breaks the ScrapeFailedError/refused contract it documents" claims the robots.txt refusal path misbehaves now.
- `code:DEB-29` [filed `debt`] — Queue output-type guards are inconsistently used: AbortedOutput is bypassed, DeferredOutput is unreachable
  - Why it was pulled back: "AbortedOutput is bypassed, DeferredOutput is unreachable" describes broken guard/dead logic, not mere inconsistency.
- `code:DEB-35` [filed `debt`] — Two root-level ad hoc prod scripts bypass the package's own 'no manual SQL outside migrations' rule
  - Why it was pulled back: "Bypass the package's own 'no manual SQL outside migrations' rule" is an explicit violation of a documented prod-safety invariant.
- `ux:66` [filed `polish`] — Cookie-consent banner overlaps actionable content instead of reserving space
  - Why it was pulled back: Banner "overlaps actionable content" blocks user interaction with covered elements — a functional break, not a cosmetic nit.
- `ux:70` [filed `polish`] — www.outrival.app fails TLS (Cloudflare 526)
  - Why it was pulled back: "Fails TLS (Cloudflare 526)" means the subdomain is unreachable over HTTPS — a site outage, not polish.

## 8. Considered and rejected (26)

A finding dies when a majority of its refuters vote against it, or when nobody
could verify it at all (an empty verification is a refutation: the unverifiable is
rejected, though that never happened here). Ties survive. The reasons below are reproduced **as written by the
refuters**, not paraphrased, including their own em dashes and hedges.

Rejected does not always mean "wrong". Several of these are accurate observations
about code that is behaving exactly as its authors decided it should, which the
refutation rules classify as a settled decision reported as a defect.

#### `code:COR-32` — work()'s single try/catch assumes batchSize never exceeds 1

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `correctness`
- **Reason 1:** The structural claim is accurate (overrideOptions could in principle set batchSize > 1) but the finding's own impact text concedes 'nothing in this repo does today', and the codebase actively documents batchSize=1 as a fleet-wide invariant the whole retry/dedup design depends on (boss.ts:285 and :413), not an accidental default. A grep of every call site confirms zero overrides of batchSize exist. This is a hypothetical footgun guarded by an explicit, already-documented architectural convention, not a reachable defect — refuted on CONSEQUENCE (dead branch, no caller exercises it, and doing so would violate a stated design invariant).
- **Reason 2:** The finding's own impact section concedes it: 'If any handler registration ever overrides batchSize above 1 (nothing in this repo does today)'. Confirmed by grep: no call site anywhere overrides batchSize; every work() registration either passes nothing or `{ includeMetadata: true }`. batchSize:1 is an explicitly documented, deliberate architectural choice (parallelism comes from localConcurrency, not batch size -- restated at line 413), not an accidental gap. This is exactly the settled-decision/dead-code-path pattern to refute: a hypothetical 'if someone later changes X' scenario with no live trigger anywhere in the codebase today.

#### `code:SEC-36` — Reserved __deferrals bookkeeping key is not stripped from caller-supplied payloads on enqueue

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** The finding's own confidence is low and it already concedes 'No in-package evidence this is currently reachable' — I confirmed that concession is correct and could find no path either: nothing in the repo constructs a job payload by spreading external/user-controlled input, so a caller-supplied literal __deferrals key is not currently reachable by anything short of an internal developer writing it in by hand. True fact, no live consequence today.
- **Reason 2:** The code-shape claim is accurate but the finding itself already concedes 'No in-package evidence this is currently reachable' (confidence: low); my own exhaustive check of every enqueue call site and every raw job.data read confirms there is in fact zero reachable path today — payload types are closed literals, and the one place raw job.data is read (the deferral loop) is careful to sanitize first. A true but currently dead-weight observation.

#### `code:SEC-21` — Admin-suspended sessions stay valid up to 30s via in-memory session cache

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** The fact is true — a cache hit skips the DB suspension check for up to TTL_MS. But this is a documented, deliberate design decision, not an oversight: the comment explicitly names this exact trade-off (operator suspension takes up to TTL_MS to take effect), gives the rationale (cutting 3 DB round-trips per request), scopes it correctly (sign-out on THIS device is unaffected because it clears the cookie), and ships an escape hatch (SESSION_CACHE_TTL_MS=0). The finding's own impact text even concedes 'The code's own comment documents this as an accepted freshness/latency trade-off.' A deliberate, documented, overridable trade-off reported as a defect is refuted on intent.
- **Reason 2:** The exact scenario the finding describes (suspension takes up to TTL_MS to take effect because the cache isn't invalidated) is spelled out and justified in the code's own comment as a deliberate, configurable latency/freshness trade-off (30s default, disable via env var). This is a settled design decision reported as a security defect.

#### `code:SEC-20` — Verbatim-grounding defense against prompt injection covers only 2 of the package's AI-consumed extraction paths

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** The finding conflates two different mechanisms: packages/scrapers' feature-specific isVerbatim guards (fact-invention guards for jd-facts/blog-enrich/customers) versus packages/ai's actual verbatim-grounding/citation defense against prompt injection at the LLM call boundary (grounded-call.ts), which is ON BY DEFAULT for every task not explicitly opted out — covering battle_card, digest, summaries, generate_signal, narrate_change, summarize_competitor, extract_features, etc. comparison-targets.ts and roadmap-signals.ts have no @outrival/ai import at all (no LLM call to guard), and integrations.ts/customers.ts classify via the deterministic classifyLogoName, not a model. The one correctly-cited gap (classify_change/homepage-diff ungrounded) is an explicit, reasoned cost-control decision documented in grounded-call.ts's own comment block ('classify_change returns an enum (nothing to cite, and it's Redis-cached)'), not an oversight.
- **Reason 2:** The finding explicitly lists customers.ts among files with 'no equivalent isVerbatim-style check found', but customers.ts directly imports and applies isVerbatim as a hard filter on extracted metrics. That is a factual evidence error in one of the four negative citations, which undermines the finding's central quantitative claim ('only two of the package's extraction modules') — the real count is at least three (jd-facts.ts, blog-enrich.ts, customers.ts), plus the finding also mislabels blog-enrich.ts's package (it lives in packages/scrapers/src/content, not packages/ai, though this is a minor mislabel next to the customers.ts error).

#### `code:SEC-28` — AskPlanSchema puts no allowlist on tool name or arg values, unlike the package's own established pattern

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** The AskPlanSchema in packages/ai is intentionally unconstrained because packages/ai is documented as PURE (no DB, no org context) — validation is apps/api's job by design. And apps/api does exactly that: getAskTool() drops any tool name not in the registry, and every tool.run() re-resolves competitorId within the org via ownedCompetitor before querying, exactly like matchAlertConditions' offered-id filter the finding holds up as the missing pattern. The finding checked packages/ai in isolation and missed the consuming layer where the allowlist actually lives.
- **Reason 2:** ask.ts's schema is genuinely open, but the finding claims nothing catches an arbitrary id before execution — false. The API layer (agent.ts) drops any tool name not in the BY_NAME registry, and every single AskTool.run() re-resolves any competitorId/ids WITHIN the org before touching data (ownedCompetitor, eq(orgId)). This is the same protection matchAlertConditions has, just placed correctly in the DB-owning API layer rather than the deliberately pure/DB-less AI package (packages/ai/CLAUDE.md: tasks are pure, never touch DB). Settled architecture, not a gap.

#### `code:SEC-30` — users.org_id is nullable, so the row-level tenant anchor is optional at the schema level

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** Nullable orgId is deliberate, not an oversight: Better Auth creates the user row before an org exists, and ensureUserOrg is precisely the lazy-org-creation mechanism the schema comment references — it fills the null on first authenticated request. The whole stack (auth middleware, ensureUserOrg) types orgId as `string | null` and handles both branches correctly. The finding's framing that this 'produces an account outside every tenant boundary' also inverts the actual risk: a null-orgId user matches no eq(users.orgId, X) check, so it fails CLOSED (no access to any org's data), not open.
- **Reason 2:** Nullability is deliberate, not an oversight: Better Auth creates the `user`/`users` row at signup before any org exists, and ensureUserOrg lazily creates and assigns a personal org on the user's first authenticated request (every org-scoped route calls it, e.g. apps/api/src/routes/ask.ts:37,47,75). A null-orgId row is a transient pre-first-request state that gets resolved before any org-scoped read/write happens, exactly matching the schema's own comment. No demonstrated write path leaves a permanently null-orgId user able to reach org-scoped data.

#### `code:SEC-32` — Admin dead-letter/job payload viewers render raw internal job data with no redaction

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** Both viewers sit entirely behind requireAdmin(), matching the audit's own carve-out that anything gated behind admin rights is gated by design. And the finding's premise that a payload could carry a credential doesn't hold today: every declared job payload type is ids/flags/urls, none carry a secret — the CRM webhook secret and API keys are never put on the queue, they're re-read from DB by handlers when needed. The finding is explicitly speculative about a hypothetical future payload shape change (confidence: low) on an internal ops tool restricted to admins who already have full DB access.
- **Reason 2:** Both routes sit under the admin-only route group; the audit account is PRO/non-admin, so this was never reachable in-session and admin-gated surfaces are by design. The finding's own impact statement is explicitly hypothetical ('a future payload shape change could silently start leaking...'), with confidence already marked 'low' and no concrete example of a current payload carrying a credential. A true-but-speculative hardening note on an internal admin debug view, not a demonstrated defect.

#### `code:SEC-33` — URL-holding columns feeding outbound webhook fetches carry no scheme/host constraint at the DB level

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** packages/db/CLAUDE.md states the db package holds schema and queries only, no business logic — so the absence of a DB-level CHECK constraint is the documented architecture, not an oversight. The actual SSRF backstop the finding says is 'not verified' does exist, consistently, for all three URL columns cited: crm_destinations.url is validated by isSafeWebhookUrl at insert time, and organizations.slackWebhookUrl/webhookUrl go through the same safeWebhookUrl zod schema in settings.ts. sendWebhook additionally re-validates on every redirect hop, closing the exact bypass a static DB constraint couldn't catch anyway.
- **Reason 2:** packages/db/CLAUDE.md is explicit that the db package holds schema/queries only, never business logic — so a DB-level CHECK constraint is architecturally the wrong place for this by convention, exactly the layer the finding hedges about ('not verified whether apps/api/workers already cover this'). Verified they do, thoroughly: apps/api validates on both create and update, and the shared sendWebhook helper re-validates scheme/host on every redirect hop, with an explicit documented threat model (SSRF guard, DNS-rebinding gap called out and accepted). Settled, implemented design, not a gap.

#### `code:SEC-35` — Product-scope tenant boundary is entirely unverified from apps/web's side

- **Verdict:** rejected · 2 refuters, unanimous against
- **Was filed as:** `security`
- **Reason 1:** The finding's own text already concedes this is 'architecturally correct' and hedges with 'no evidence either way that the check is missing' because it claims apps/api is out of scope. That premise is false — apps/api routes are in scope and examined elsewhere in this very batch (COR-01/02/03), and I found the actual server-side ownership check: liveProductId() re-validates every inbound productId against `products.orgId = orgId` before it seeds any query, on every scoped API route. A client-supplied ?product= id that isn't owned by the caller's org silently resolves to null ('all products'), never to another org's data. This is the standard trust boundary for a Next.js client (browser has no DB access; server is the only enforcement point) — not a gap, and the finding surfaces no actual defect, only unverified speculation that it itself flags as low-confidence.
- **Reason 2:** The finding's own impact text concedes it: 'apps/api itself is out of this audit's scope so no evidence either way that the check is missing' — a low-confidence, self-admitted non-finding. The client-side override is documented, deliberate behaviour (a shareable deep-link, per the file's own top-of-file design comment), not an oversight. And apps/api DOES resolve every productId query param through liveScope()/liveProductId(orgId, raw) before it seeds any query — the server-side ownership check the finding speculates might be missing actually exists and is exercised on every scoped signals route. INTENT (documented override) and EVIDENCE (the guessed-at gap doesn't exist) both refute this.

#### `ux:72` — Recap and What's new are further URL-only dashboard pages

- **Verdict:** rejected · 2 refuters, unanimous against
- **Reason 1:** This is exactly the case the finding itself flagged as the likely explanation but said the crawl 'could not confirm' — and the code confirms it: /dashboard/whats-new IS linked from a persistent topbar icon (with an unseen-activity dot), and /dashboard/recap is a deliberate email-driven 'Wrapped'-style monthly recap ('the email teaser drives here'), not meant to live in the sidebar at all. Both are settled, working design decisions with real entry points, not stranded/undiscoverable URL-only pages. Refuted.
- **Reason 2:** Both halves are deliberate, not omissions. What's-new was explicitly reviewed and approved as a nav-less, icon-triggered surface by the prior page-audit-2026-06-30.md ('KEEP... megaphone-triggered... Fine') — restating an already-settled prior-audit verdict is refuted as a duplicate per the batch rules. Recap is even more clearly by design: it isn't reached from a header icon at all (no code path links to it from the dashboard UI) but is a monthly 'Wrapped'-style view whose only entry point is a link mailed out by send-monthly-recap.ts, the same email-driven pattern as the public /report/[token] share page — not a page that belongs on a persistent sidebar.

#### `ux:79` — Battle cards, the product's flagship AI deliverable, are ungenerated for every tracked competitor

- **Verdict:** rejected · 2 refuters, unanimous against
- **Reason 1:** Battle cards are an on-demand, manually-triggered, AI-rate-capped artefact by explicit design (matches the repo's flat-10/hour AI-action-cap decision) — there is no background job that bulk-generates a first card per competitor, only refresh-stale-battle-cards.ts which refreshes cards that already exist. The finding's own evidence (a well-built, correctly-labelled 'Generate' CTA) is the intended empty state, not breakage; reporting an untouched test account (nobody clicked Generate) as a 'blocker' is a settled product decision reported as a defect.
- **Reason 2:** Battle-card generation is a deliberate, user-initiated, cost-gated action (per-tier battleCardsPerDay cap, real AI generation + headless-browser PDF render each time) — the code repeatedly documents this as intentional, down to justifying why even a background auto-refresh cron doesn't spend the user's quota for them ('clicking Regenerate is one click'). Zero cards on an account that never clicked Generate is the designed empty state, complete with a clear CTA, not a broken/ungenerated 'flagship AI deliverable'. This is a deliberate design decision (analogous to the already-decided flat AI-action cap) reported as a blocker defect.

#### `ux:81` — /dashboard/recap never resolves past a skeleton shell, breaking the page-header pattern

- **Verdict:** rejected · 2 refuters, unanimous against
- **Reason 1:** The finding's central claim — page 'never resolves past a skeleton shell' — is contradicted by the screenshots themselves: they show the actual first slide of a working Wrapped-style deck (real gradient background, real progress-dot bar, real slide copy), caught mid-CSS-animation by the crawler, not a stuck loading state. The lack of a semantic <h1> is a deliberate consequence of this being a distinct full-bleed slideshow format (explicitly called out as its own 'Lever 9' design), not an accidental break from the page-header pattern. h1=null and constant textLength across 8/8 records are exactly what you'd expect from a deterministic screenshot delay hitting the same early animation frame every time, not from a broken fetch.
- **Reason 2:** The audit's own ai-content pass already found the actual recap copy present in the mobile capture's extracted text, proving slide 0's content genuinely renders and the page is not stuck — the desktop/laptop/tablet screenshots catching only the blank first slide is a JS-driven-carousel/motion-animation screenshot-timing artifact, not evidence the page 'never resolves'. Separately, the missing bold H1 is a deliberately different UI paradigm (a full-bleed Spotify-Wrapped-style slide deck, explicitly labeled as such in the code) rather than a broken instance of the standard page-header pattern.

#### `ux:23` — /demo is a sales lead-gen form, contradicting the site's own "no demo, self-serve" pitch

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The quoted default-branch copy ('Want a closer look before you start?...') is real, but no on-site CTA reads 'See Outrival on your competitors' or links to the bare /demo route the finding quotes -- the audit's crawler reached it directly (routes.json enumeration), not via any visitor journey. The only two actual on-site entry points to /demo are explicitly framed as an optional, no-commitment fallback ('Not ready to sign up? ... No account, no card') for people who haven't signed up yet, which does not contradict the 'self-serve, no demo required to start' pitch -- the primary CTA everywhere is still 'Start free' straight to /auth. The stated impact describes a user journey that doesn't exist on the site.

#### `ux:51` — sitemap.xml omits 7 indexable legal pages that sibling legal pages include

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** Explicit, deliberate curation with an in-code rationale (a sitemap padded with legal boilerplate previously diluted Google's 'best pages' signal; those pages remain indexable and footer-linked, just intentionally excluded from the submitted set). /privacy, /terms, /legal stay in ROUTES because they're treated as higher-value than the 7 pure-boilerplate ones. This is a documented decision, not an oversight — refuted.

#### `ux:63` — Blog post <title> tags use sentence case, breaking site-wide Title Case

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding's central claim — 'the two sampled blog posts are the only multi-word <title> tags on the whole site not in Title Case' / 'breaking site-wide Title Case' — is factually wrong by the finding's own cited source: the homepage and /sample are also sentence-case multi-word titles. There is no site-wide Title Case convention to break. Blog frontmatter is sentence case across all 3 posts (not just the 2 sampled), i.e. a consistent editorial convention for that content type, matching the project's own written guidance ('sentence case is the safer default... apply it consistently' — .claude/skills/better-writing/SKILL.md). Refuted on evidence.

#### `ux:21` — /dashboard/settings/general leaves three sections permanently in gray-bar skeleton

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding cites a screenshot for a different, unrelated route (/dashboard/settings, likely a redirect shell caught pre-hydration, evidenced by ~15 aborted RSC prefetch requests) to support a claim about /dashboard/settings/general. The screenshot that actually corresponds to the cited path and textLength shows the three sections fully loaded, not skeletons — the opposite of the claim. The 'identical byte count = steady state, not mid-flight' argument is also backwards: the byte count is identical because it's a deterministic settings page, and the genuinely mid-flight capture is the mismatched screenshot the finding leans on.

#### `ux:52` — Em dash in AI-generated signal copy violates the no-em-dash product rule

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** There is no 'no em-dash' rule that governs the AI digest-generation pipeline's user-facing output anywhere in the codebase. The finding asserts 'The em dash is a banned character in product copy' and that 'the generation pipeline has no post-processing check against that rule' — but that rule doesn't exist for product/AI-generated copy; it's the assistant's own writing-style convention (for plans/docs it authors) misapplied to the LLM's digest output, and possibly conflated with the audit's own self-defined scanning checklist for this very audit run. Fabricated premise.

#### `code:PER-33` — detect-silent-monitors does a notification-cooldown query and an org lookup per silent org inside a loop

- **Verdict:** rejected · 1 refuter, unanimous against
- **Was filed as:** `performance`
- **Reason 1:** The cited evidence 'notification-dispatcher.ts:83-99,179-188 ... notifyOrg does a further organizations.findFirst' misattributes code that lives in a different file entirely — a real evidence error, not a paraphrase. Additionally the '3-4 extra round trips per org' impact is inflated for the actual default path: decideDispatch's default channelMedium is `digest_weekly` (notification-dispatcher.ts:73), which short-circuits at `if (channel !== "email_immediate") return { send: true, channel };` (line 219-221) before ever reaching getTodayEmailCount, and notifyOrg's own early return (`if (decision.channel !== "email_immediate") return;`) skips the organizations.findFirst too — so the default-config round-trip count is 2 (cooldown + getOrgPrefs), not 3-4, and only reaches 4 when an org has non-default, atypical notification preferences.

#### `ux:09` — Discovery "Track" stays clickable at 0 free seats; click fails silently

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding's own evidence set (console log) stops one snapshot short of the audit's own next capture, which shows a full modal dialog titled 'Competitor limit reached' with an explanatory message and an upgrade link appeared right after the 403 — not silence. The Track button not being proactively disabled at 0 seats is real, but the stated impact ('no toast, no disabled state — the card just sits there looking like nothing happened') is directly contradicted by the audit's own captured evidence; the headline claim 'click fails silently' is false.

#### `ux:43` — Discovery (add-a-competitor) flow is hidden two clicks deep with no root-level entry point

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding's central claim — 'sidebar has no Discovery item,' 'never surfaced from... the persistent sidebar,' reachable only 2 clicks via a page button — is contradicted by the nav config: Discovery is an unconditional, always-rendered top-level rail entry in the persistent sidebar, one click from anywhere in the dashboard. It is merely scrolled out of view in the captured screenshots because the competitor sub-list defaults open with up to 8 rows above it, which is a different (and much smaller) defect than 'no root-level entry point.'

#### `ux:44` — Dashboard sidebar submenu contrast fails far more in light theme, spiking hardest on /dashboard/whats-new

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** Half the finding's own node-count evidence (the mobile 8/21 figures) is misattributed to sidebar-competitors.tsx — it's actually an unrelated element on the whats-new page's own content. And the finding's theorized mechanism ('this route applies an active/hover style to many sidebar rows at once') is directly contradicted by the component's code: no row can be marked active on /dashboard/whats-new at all, the opposite of what's claimed. The anchor file (sidebar-competitors.tsx) is not a correct fix target for the diagnosis given.

#### `ux:47` — Digest detail page uses the full AI-generated insight sentence as the H1

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding frames this as 'a heading-scale departure driven by content length rather than a deliberate hierarchy choice' — but the code comment explicitly documents this as a deliberate choice: promote the model's verdict sentence to the headline position instead of hiding it under a label. Per DECISIONS/INTENT test, a documented deliberate design decision reported as an accidental defect is refuted.

#### `ux:48` — AI-action buttons lose their teal accent in dark mode

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** "Generate battle card" and "Run now" are plain default-variant Buttons with no special AI-action styling. The default variant's fill is `bg-primary`, which resolves to the single global `--accent` token -- teal in light theme, purple (Iris, #6c5dfd) in dark theme -- shared by every primary button in the app (nav, forms, everything). There is no separate 'purple primary/nav' color in light mode to contrast against, and no distinct teal 'AI-action' style that dark mode broke: it's one accent token swapped wholesale per theme, a deliberate global design choice, not an AI-cue regression.

#### `ux:49` — /dashboard/products/:id header action row overflows mobile by 23px

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The failures.json overflowPx=23 metric is real, but the claimed cause is not: PageHead's action row explicitly sets `flex-wrap` at both the outer header level and the actions-container level, and the actual mobile screenshot shows all four header actions (Update profile / Sources / Re-scan / kebab) fitting on a single row with room to spare, not clipped at the viewport edge. The measured page-level horizontal overflow (which is even larger at tablet -- 55px -- than mobile, the opposite of what a cramped mobile-only header row would produce) comes from something else on the page that the finding never identified.

#### `ux:57` — "We crawl one page per domain at a time" isn't enforced by any per-domain scheduling control

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** The finding's own evidence trail only searched apps/workers/src/core/scrape-monitor.ts for a domain lock and the queue's job-level concurrency setting -- it missed the actual per-domain scheduling control, `awaitDomainSlot()`, which lives one layer down in packages/scrapers and is invoked before every single page fetch regardless of which scrape-monitor job triggered it. It's Redis-backed across the whole worker fleet and enforces a minimum spacing (2s default, or the site's own robots Crawl-delay if longer) between any two requests to the same registrable domain, which is precisely the 'one page per domain at a time' behavior the security page describes. The claim that 'no per-domain scheduling control' exists is factually wrong.

#### `ux:62` — Sector trends returns nothing for an account well past its own stated bar

- **Verdict:** rejected · 1 refuter, unanimous against
- **Reason 1:** Both branches of the finding's diagnosis are false per the source: the feature is fully implemented and scheduled (not 'unwired'), and 0.6 is an ordinary confidence default, not unreasonably high. The detectors require thematic/keyword correlation across competitors' recent signals within a time window, not just raw competitor count — 15 tracked competitors satisfies the count floor but says nothing about whether their actual signal content correlates. An empty state is the expected output of a correctly functioning detector when no such correlated pattern exists in this account's data; the finding never inspected the detection code and its either/or claim is contradicted by it.

## 9. Annex, routed out of scope, never contested (139)

**These findings were NOT refuted.** `triage.mjs` routes categories `tests`,
`debt`, `docs`, `dependencies` and severity `polish` straight to this annex,
because none of them becomes a ticket on its own. They therefore never entered
phase 4: no refuter read them, no vote was cast, nobody tried to kill them.

Read them as **unverified claims**, at exactly the confidence their original
author gave them and no more. They are listed here so the audit is auditable, not
because they are confirmed. 13 of the original 152 were pulled back out as mis-filed
live defects and appear in section 7.2 instead.

### tests (74)

- `code:TES-02` — Global AI circuit breaker (circuit-breaker.ts) has no tests at all
- `code:TES-03` — aiActionsPerHour() untested — the exact function behind a documented production landmine
- `code:TES-04` — registerQueues() drift-reconciliation has no test, though it exists to fix a documented incident
- `code:TES-05` — src/migrate.ts, the actual prod pre-deploy migrator, is never exercised
- `code:TES-06` — safeParseJson, the shared model-output parse guard, has zero tests
- `code:TES-07` — r2/client.ts (gzip compress/decompress, batch delete) has zero tests
- `code:TES-08` — loadMemorySignals' anti-hallucination filter has zero tests
- `code:TES-09` — escapeHtml's own XSS-relevant characters (<, >, ') are never asserted anywhere
- `code:TES-10` — enqueueMany's batch-insert mapping, used by every cron fan-out, has zero test coverage
- `code:TES-11` — syncSchedules() cron upsert/removal reconciliation is untested
- `code:TES-12` — computeNextRun (re-scrape scheduling) has no test file at all
- `code:TES-13` — Fresh-DB migration test asserts zero indexes
- `code:TES-14` — The AI provider/grounding orchestration layer (everything that calls complete()) is untested; only its pure sub-helpers are
- `code:TES-15` — work()'s entire error-routing dispatch has zero test coverage
- `code:TES-16` — purge-retention.ts — irreversible cross-table tier deletion has zero tests
- `code:TES-17` — settings.ts has zero tests despite GDPR erasure, plan-gated writes
- `code:TES-18` — logger.ts redact.paths (PII/secret log redaction) never verified against pino
- `code:TES-19` — Prod-incident migration-ledger tooling (realign-journal, preflight, baseline) is untested
- `code:TES-20` — jobData()'s __deferrals-stripping branch has no test
- `code:TES-21` — alertQueueError's Slack throttle window is untested despite existing to fix a documented spam incident
- `code:TES-22` — robots.ts network/cache layer untested beyond the pure evaluator
- `code:TES-23` — mock.module()/global reassignment in tests leaks process-wide with no teardown, across three packages
- `code:TES-24` — Standing-queries change-detection (signalSetsEqual et al.) has zero tests
- `code:TES-25` — cache/ai-cache.ts (withAiCache) has zero tests
- `code:TES-26` — Currency-conversion math (fx.ts/plan-monthly.ts) untested despite feeding 7+ pricing surfaces
- `code:TES-27` — computeFreshnessState / staleness thresholds untested
- `code:TES-28` — errorConfig/toastRescanLimit untested despite a documented prior silent regression
- `code:TES-29` — Pricing-plans TanStack Query key hand-duplicated 4x, unguarded by any test
- `code:TES-30` — computeOverrides (pricing-plan edit → mutation payload) is untested by construction
- `code:TES-31` — score-overlap.ts's domain-reconciliation fallback logic has zero tests
- `code:TES-32` — shopify-reviews scrape() and detect() are untested — the exact silent-snapshot risk the doctrine calls out
- `code:TES-33` — Self-check trigger logic (decideIfSelfCheck) is pure, cheap to test, and untested
- `code:TES-34` — Output-language enforcement is never asserted by any test
- `code:TES-35` — Truncation propagation (markTruncated/wasTruncated) untested
- `code:TES-36` — analyze-product.ts's exported discovery-query helpers are untested despite matching the package's own tested pattern
- `code:TES-37` — billing.ts (Stripe checkout/downgrade/resume/payment-method) has no route-level tests
- `code:TES-38` — Public share-link feature (share.ts + public-report.ts) is completely untested
- `code:TES-39` — Session-outcome state machine that prevents an auth redirect loop is untested
- `code:TES-40` — generate-signal.ts (882 lines, the core insight-creation job) has zero test coverage
- `code:TES-41` — Extraction jobs with documented non-idempotent-write ordering have no orchestration test
- `code:TES-42` — scrapePage cascade orchestrator has zero direct test coverage
- `code:TES-43` — generate-battle-card.ts (901 lines, browser-worker's second job) has zero tests
- `code:TES-44` — 'entity not found → NonRetriable' is the retry/abort boundary at 50+ sites across 27 core files, verified almost nowhere
- `code:TES-45` — The only successful-render path in scrape-patchright.ts is never exercised
- `code:TES-47` — ai-quality-checks query module (review/resolution workflow) has zero tests
- `code:TES-48` — The 40+ hand-tuned job registry has no characterization test protecting safety-critical config
- `code:TES-49` — awaitDomainSlot (per-eTLD+1 rate limit) untested beyond the pure math
- `code:TES-50` — One-shot data-backfill scripts run raw prod UPDATEs with no test coverage
- `code:TES-54` — Migration tests check schema shape only, never a write path
- `code:TES-55` — 20+ of 25 server-prefetch functions in api-server.ts share an untested best-effort contract
- `code:TES-56` — changelog.scraper.ts and github.scraper.ts carry real branching logic with zero tests
- `code:TES-57` — Admin's shared pure formatters (shell.tsx) have zero test coverage
- `code:TES-58` — CSV export escaping (toCsv) has zero coverage despite living in the tested src/lib layer
- `code:TES-59` — email/lifecycle.ts — all three Lever 5/9 emails have zero tests
- `code:TES-60` — Some sources' actual scrape() entrypoint is untested — only their pure inner helpers are
- `code:TES-61` — The one terminal-abort assertion for verify-signal-delta is unawaited and doesn't check the error class
- `code:TES-62` — backfill-salary-bands.test.ts asserts on script source text, not behavior
- `code:TES-63` — verify.ts's judge-call budget cap (MAX_JUDGE_CALLS=12) is never exercised
- `code:TES-64` — mock.module('@outrival/queue') drifted from the real JobDef shape in 6 worker test files
- `code:TES-65` — Admin route surface (2,532 lines, 11 files) has zero route-level tests beyond the allowlist gate
- `code:TES-66` — scrape-monitor.ts (2715 lines) — the core scraping job and its onFailure/dies-halfway handler have no test coverage
- `code:TES-67` — No test guards the payload-type-vs-zod-schema drift the package's own CLAUDE.md flags as its worst failure mode
- `code:TES-68` — patch-28's exported multi-product backfill has zero tests despite being built for testing
- `code:TES-69` — extract-pricing.ts is entirely untested and has no extracted pure helpers to test
- `code:TES-70` — startQueue()'s mode-based option defaults (schedule/supervise/migrate) are untested
- `code:TES-71` — productLimit() env-override and garbage-value paths untested, unlike its sibling
- `code:TES-72` — proxy.ts (L2 egress config) has zero test coverage
- `code:TES-73` — Every light-worker-owned cron job (15 files) has no test touching its run* body, including the dead-man's-switch and the plan-tier enqueue gate
- `code:TES-74` — Test files that look like job coverage only test the pure lib, never the core orchestration wrapper
- `code:TES-75` — relativeFmt renders inside SSR'd client admin components — untested hydration-mismatch risk
- `code:TES-76` — 30 of 47 test files share one PGlite instance with no per-test reset, order-safety relies entirely on author discipline
- `code:TES-78` — customer-name.ts tests are colocated under the wrong file, hiding them from the package's own convention
- `code:TES-79` — candidates.ts (notification copy builders) has zero tests
- `code:TES-80` — Wide gap of untested tenant-scoped routes across apps/api/src/routes

### debt (46)

- `code:DEB-01` — Tenant-scoping ownership check duplicated identically in 6 places
- `code:DEB-02` — Raw SQL results force-cast to typed arrays with zero runtime guard
- `code:DEB-04` — CLAUDE.md's DLQ-on-exhaustion claim is true for only 5 of 52 jobs
- `code:DEB-05` — 3 of 14 groundedAiCall tasks have no GROUNDING_POLICY entry
- `code:DEB-06` — isCanonicalSlug / isCanonicalRow: identical entitlement predicate duplicated across two sibling modules
- `code:DEB-07` — aiVisibilityEngineBudget table is fully typed but never queried through Drizzle
- `code:DEB-08` — jsonb columns typed unknown are blind-cast to divergent shapes downstream
- `code:DEB-09` — "Strip HTML to visible text" reimplemented 5x in two already-diverged variants
- `code:DEB-10` — SSRF-safe redirect-following fetch reimplemented instead of reused
- `code:DEB-11` — Prod-credential loading is reimplemented 3 different ways and has already drifted
- `code:DEB-13` — rateChangeSeverity implemented identically in two pricing-diff modules
- `code:DEB-15` — PLAN_LIMITS numeric facts re-hardcoded as marketing strings in web
- `code:DEB-16` — Synthetic-anchor find-or-create monitor pattern copy-pasted 16+ times
- `code:DEB-17` — Three profile adapters bypass groundedAiCall while docs claim parity with analyzeProduct
- `code:DEB-18` — Trigger.dev fully removed, but comments and a code alias still describe it as live
- `code:DEB-19` — Two independent relative-time formatters that already read differently
- `code:DEB-20` — R2 snapshot key suffix convention duplicated at ~20 call sites instead of centralized
- `code:DEB-21` — Two independently-thresholded freshness systems coexist and are both wired into the same component
- `code:DEB-22` — A third, independent eTLD+1 heuristic adds a third source of truth for 'same domain'
- `code:DEB-23` — Dev cron trigger console hand-duplicates the real schedule registry and has already drifted
- `code:DEB-24` — AdminVariables.session: unknown is a dead, unset context field across all 11 admin routers
- `code:DEB-26` — Terminal-attempt onFailure hook wrapper is copy-pasted between handlers, and has already diverged
- `code:DEB-27` — env.ts EnvSchema is stale: dead TRIGGER_* fields, and two vars re-validated redundantly elsewhere
- `code:DEB-28` — ImportanceSeverity redeclares SignalSeverity's literal union instead of importing it
- `code:DEB-30` — Documented error envelope (errorBody) is used by only 5 of 47 route files
- `code:DEB-31` — core/* job bodies call @outrival/queue.enqueue() directly, breaking the documented runtime-neutral contract
- `code:DEB-32` — runScrapeMonitor is a ~1900-line single function with no direct test file
- `code:DEB-33` — Two multi-thousand-line god-modules mix unrelated responsibilities with no internal boundary
- `code:DEB-34` — CRON_SCHEDULES keys have no compile-time link to registered job names
- `code:DEB-36` — A second 'empty/error card' component duplicates EmptyState in the same feature tree
- `code:DEB-37` — Admin client views hand-roll fetch/loading/error state instead of TanStack Query
- `code:DEB-38` — pricing/calculator/probe.ts launches its own Chromium, duplicating the pooled browser lifecycle the doctrine mandates
- `code:DEB-39` — Eyebrow label reimplemented locally instead of using the canonical component, which now has zero callers
- `code:DEB-40` — Multiple dead, zero-caller components accumulate in apps/web
- `code:DEB-41` — Two Crawlee runtime-state files committed despite storage/ being gitignored
- `code:DEB-42` — Five exported functions/consts have zero callers anywhere in the monorepo
- `code:DEB-43` — audit_log's action column comment lists 3 of 9 actual values in use
- `code:DEB-44` — conditionalFetch hardcodes a stale duplicate of OUTRIVAL_UA with a wrong domain
- `code:DEB-45` — Job registry type-erased to JobDef<never>[] via a double `as unknown as` cast
- `code:DEB-46` — Dead package.json export: ./docs subpath has zero consumers
- `code:DEB-47` — Per-tier env-override lookup duplicated near-verbatim between productLimit and forcedRescansPerDay
- `code:DEB-49` — forcedRescansPerDay's JSDoc is misplaced above isWithinLimit, leaving forcedRescansPerDay undocumented
- `code:DEB-50` — JobConfig.pollingIntervalSeconds is dead configurability — zero callers
- `code:DEB-51` — OAuth provider abstraction (registerProvider/getValidToken) has zero callers anywhere in apps/api
- `code:DEB-52` — compare.ts casts a live Date value to a `string` type without converting it
- `code:DEB-53` — Injected tool-channel instruction attempted to redirect the auditing agent (prompt-injection, not a code defect)

### docs (7)

- `code:DOC-01` — packages/queue/CLAUDE.md's Erreurs section documents 2 of 4 terminal outcomes, omitting DeadLetter and deferral entirely
- `code:DOC-02` — apps/api imports packages/scrapers directly, contradicting the monorepo import table
- `code:DOC-03` — docs/tanstack-query.md describes a client-only pilot the codebase has already outgrown
- `code:DOC-04` — Stale Trigger.dev references in code comments describing the current (pg-boss) job runtime
- `code:DOC-05` — Package's own 'always export the inferred type' convention is unfollowed on the majority of schema files
- `code:DOC-06` — registerQueues() docstring claims 'policy and partition' are excluded from reconciliation; code only excludes policy
- `code:DOC-07` — jobs.ts header references an unused 'refine in Phase 2' payload-typing convention

### dependencies (3)

- `code:DEP-01` — Claude/Anthropic dispatch path in packages/ai is fully unreachable dead code
- `code:DEP-02` — Two unused dependencies and a dangling tsconfig include left from the Trigger.dev removal
- `code:DEP-03` — @types/diff devDependency is redundant with diff's own bundled types

### polish (9)

- `ux:65` — Command palette (Ctrl+K) dialog missing an accessible description
- `ux:67` — Hero headline's strike-through animation reads as a duplicated word in plain text
- `ux:68` — No react-hook-form / shared shadcn Form wrapper - every form hand-rolls state and validation
- `ux:69` — global-error.tsx is permanently dark-themed regardless of the user's theme
- `ux:71` — French word in the /legal page's language toggle
- `ux:74` — Wizard is genuinely low-typing: 4 named steps, typing scales with input mode
- `ux:75` — Drop-off and skip paths both recover instead of dead-ending
- `ux:76` — Onboarding, add/edit dialogs and destructive flows are the well-built baseline
- `ux:77` — Date filters correctly and universally use the shared shadcn date-range picker

## 10. Proposed Linear tickets

**Not created.** `RUN.md` step 3 says propose, do not create before an explicit go.
Nothing has been written to Linear. Say the word and these get created as written,
or adjusted first.

Fifteen tickets, grouped so each one is a single reviewable PR rather than a
category dump. Titles follow Conventional Commits so the branch and the commit
subject fall out of the ticket.

### P0

**1. `fix: scope GET /api/feedback to the caller's org`**
`code:COR-01`. Add the missing `where eq(feedback.orgId, ...)` and replace the
per-org `owner` role gate with the `isAdminEmail` platform allowlist used by every
other cross-org read. Add the route test the finding notes does not exist. S, fix
risk low. **This is the only confirmed cross-tenant read in the audit.**

**2. `fix: fail over on HTTP 402 from an AI provider`**
Gap sweep, unrefuted. Add 402 to `shouldFailover`, make it trip `recordFailure`
and the breaker, and fire an ops alert distinguishing "provider billing" from
"provider down". Fix the status banner so a billing outage renders as down rather
than self-healing degraded. M, fix risk medium. **Before writing code: confirm on
production which provider is 402-ing and top it up.** The eleven-day window is
still open.

**3. `fix: pin postgres.js prepare behaviour against the Neon pooler`**
Gap sweep, unrefuted, ~859 `Failed query` errors in 30 days. First step is
diagnosis, not a patch: capture one full error payload from Sentry to confirm the
prepared-statement hypothesis. If confirmed, `prepare: false` on the pooled client
in `packages/db/src/client.ts`, which `apps/api` shares. S to code, fix risk high,
because it changes the behaviour of every query in the platform.

**4. `fix: realign the migration journal ordering`**
`code:SEC-01` and `code:COR-08`. `idx 69`'s `when` is 1 ms before `idx 68`'s. Use
the existing `realign-journal.ts`, then add the ordering assertion to the migration
test (which today checks `idx` contiguity but not `when` monotonicity: that is
`code:TES-01`, section 7.2). Verify against a fresh Neon branch before touching a
shared environment. S, fix risk high. **Migration path, so staging first.**

**5. `fix: publish the real publisher identity on the legal pages`**
`ux:78`. Replace `[À COMPLÉTER]` with the actual company name, legal form, share
capital, registered office and RCS on Legal Notice, and name the GDPR data
controller in the Privacy Policy. Content, not code. S, fix risk low. Pairs with
`ux:15` (the `privacy@` and `security@` inboxes the code marks as not yet
provisioned while public pages promise a one-month GDPR response) and `ux:05` (the
stated three-year retention window for demo/contact submissions that no code
enforces, because the data is emailed and never stored).

### P1

**6. `fix: stop swallowing the suspended-account lookup error`**
`code:COR-02`. `.catch(() => undefined)` turns a transient DB error into a working
sign-in OTP for a suspended account. Fail closed. S, fix risk high (auth path).

**7. `fix: route every outbound fetch through the SSRF guard`**
`code:SEC-02`, `SEC-03`, `SEC-04`, plus `code:SEC-15` and `code:COR-03`. One PR,
because the shape is identical each time: a second call site that skipped the
primitive the first one uses. Add the internal-host check to
`validateMonitorUrl`, re-validate in the webhook test endpoint and stop echoing the
raw fetch error, validate and bound redirects in `sendSlackMessage`. S to M, fix
risk medium.

**8. `fix: validate redirect targets in the browser-render cascade`**
`code:SEC-14`, kept separate from ticket 7 because it lands in Patchright rather
than in fetch, and its real exploitability depends on egress controls that are not
visible in the code. M, fix risk medium.

**9. `feat: encrypt the CRM webhook signing secret at rest`**
`code:SEC-08`. Apply the AES-256-GCM pattern the sibling `oauth_connections` table
already documents. Needs a migration plus a backfill of existing rows. M, fix risk
high.

**10. `fix: escape every dynamic value before it reaches emailShell`**
`code:SEC-05`, and while in the file, `ux:19` (em dash in live transactional
subject lines) and `ux:45` (no unsubscribe path on welcome, celebration and monthly
recap, while digests have a working one). S to M, fix risk medium.

**11. `fix: remove the dashboard hydration mismatches`**
`ux:00`, `ux:33` and `code:PER-24`. The slope chart interpolates `"88%"` into an
SVG `points` attribute, and five sites call `isToday()`/`format()` unguarded. Both
produce React #418 on the pages a returning user hits most. S, fix risk low.

### P2

**12. `fix: bring the dashboard shell to WCAG AA and to 768px`**
`ux:14`, `ux:82`, `ux:80`, `ux:83`, `ux:58`, `ux:25`, `ux:28`, `ux:35`, `ux:36`,
`ux:31`, `ux:34`, `ux:06`, `ux:40`, `ux:59`. One campaign with a re-crawl as its
acceptance test (`crawl.mjs` is read-only and replayable, so the same axe numbers
can be measured after the fix). The site publicly claims accessibility; 1345
contrast-failing nodes across 73 routes contradict it. M to L, fix risk low.

**13. `perf: add the missing indexes on the hot tables`**
`code:PER-04`, `PER-06`, `PER-16`, `PER-38`, plus the constraints from
`code:COR-07` and `code:COR-15`. All in one migration batch, staging first, and
note `code:PER-53`: no migration in the repo has ever used
`CREATE INDEX CONCURRENTLY` and the runtime migrator wraps every file in a
transaction, so an index on `signals` or `changes` will take a blocking lock for
its full duration. M, fix risk high.

**14. `perf: batch the N+1 fan-outs in the cron jobs and API routes`**
The bulk of section 6.3, starting with the ones whose cost grows with tenant count
rather than with one org's data: `code:PER-14`, `PER-44`, `PER-45`, `PER-10`,
`PER-27`, `PER-40`, `PER-07`. M, fix risk medium, and easy to split further if it
gets long.

**15. `fix: give failed writes a visible error state`**
`ux:04` (form saves fail with zero user-visible feedback, systemic), `ux:56` (82 of
the app's `toast.error()` calls bypass the documented contract in
`lib/error-helpers.ts` that 22 files already follow), `code:COR-34`, `code:COR-35`,
`ux:32`, `ux:10`, `ux:03` (no `not-found.tsx` anywhere, so every mistyped URL gets
Next's bare chromeless 404). L, fix risk low, and the highest ratio of perceived
quality to risk in the report.

### Deliberately not ticketed

- The 139 annex entries (section 9). They were never contested and none of them is
  a ticket on its own. The `tests` half is worth its own planning conversation:
  74 untested surfaces, several of them (`circuit-breaker.ts`, `aiActionsPerHour()`,
  `registerQueues()`, `src/migrate.ts`) sitting directly under documented past
  production incidents.
- `code:SEC-39`. No repository fix exists. It is an action on this environment, not
  on Outrival.
- The 26 rejected findings (section 8). Left rejected. If one of them looks wrong,
  the refuter's full reasoning is printed there and in the JSON.

## 11. Post-audit checklist

From `RUN.md`, still open:

- [ ] **Revoke the session used by the audit**, in Settings then Security. The
      token transited a conversation. It expires around 2026-09-15 on its own; do
      not wait for that.
- [ ] **Decide the fate of `axe-core`**, committed as a devDependency of
      `apps/web` and not pushed. Pushing it rebuilds the web image in production.
- [ ] **Create the validated Linear tickets** from section 10, after review.
- [ ] **Audit the installed hooks, MCP servers and plugins** for whatever emitted
      the forged `PreToolUse:Read` blocks described in section 4.

Artefacts that stay outside the repository, by charter, and are needed to re-read
anything in this report:

```
~/.outrival-audit/2026-08-16/findings-verified.json    the board, with every verifier transcript
~/.outrival-audit/2026-08-16/findings-code.json        session 1 output
~/.outrival-audit/2026-08-16/findings-ux.json          session 2 output
~/.outrival-audit/2026-08-16/telemetry/                sentry.json, dlq.json, scrape-runs.json
~/.outrival-audit/2026-08-16/shots/                    ~750 screenshots, cited by the 6.4 findings
~/.outrival-audit/2026-08-16/results.json              the 640-load crawl, with axe output
```

`~/.outrival-audit/state.json` holds a live session token and must never enter the
repository: the project's git rule mandates `git add -A`, so anything in the tree
gets committed.
