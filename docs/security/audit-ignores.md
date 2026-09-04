# Suppressed security findings

CI blocks on three scanners (`.github/workflows/ci.yml`): `pnpm audit --prod
--audit-level=high`, trivy (fs, HIGH/CRITICAL, `ignore-unfixed`) and gitleaks over the
full history. None of them ends in `|| true` any more — audit 2026-09-02 finding D-01
found that the informational `pnpm audit` step had been reporting 26 high advisories
that nobody read.

A blocking gate is only useful if silencing it costs something. This file is that cost:
**no suppression exists anywhere without a dated entry here.**

## Rules

1. Fix or bump first. A suppression is for an advisory with no upstream fix, or one that
   is provably unreachable from our code.
2. Prefer a `pnpm.overrides` floor (root `package.json`) over a suppression. It fixes the
   tree instead of hiding it, and it keeps working for the next contributor.
3. Every entry below carries: the id, where it comes from, why it does not reach us, the
   date it was added, and the condition that removes it.
4. Review on the first of the month. An entry older than 90 days is either fixed or
   re-argued, not renewed silently.

## Current state, 2026-09-04

**`pnpm.auditConfig.ignoreGhsas` is empty.** It held 17 undated ids with no rationale
before wave 3 of the audit remediation; all 17 were resolved by bumping four direct deps
(next 16.2, hono 4.12.34, sharp 0.35, next-mdx-remote 6) and adding nine `overrides`
floors. `pnpm audit --prod --audit-level=high` exits 0 with nothing suppressed.

**No `.trivyignore`, no gitleaks allowlist.** If trivy trips on a dev-only advisory that
`pnpm audit --prod` does not see, the fix is an entry here plus `.trivyignore`, not
loosening the severity filter.

## Accepted below the gate

Not suppressions: these are under the HIGH threshold and CI does not fail on them. Listed
so the next person does not re-investigate them from scratch. 14 advisories, 10 moderate
and 4 low, all transitive, none with a fixed version reachable without a major bump of a
direct dependency.

| Package | Sev | Reached through | Why it waits |
|---|---|---|---|
| `dompurify` | mod + low | `apps/web > posthog-js` | posthog-js pins it; we never call the sanitizer ourselves |
| `protobufjs` | mod | `apps/api > @sentry/node > @opentelemetry/*` | OTLP exporter path, only serialises our own spans |
| `@opentelemetry/core` | mod | `apps/api > @sentry/node` | same tree, waits on a Sentry release |
| `@xmldom/xmldom` | mod | `apps/api > mammoth` | docx parsing of user uploads: the one worth watching |
| `fflate` | mod | `apps/web > posthog-js` | session-recording compression, no attacker-chosen input |
| `esbuild` | mod + low | `apps/api > better-auth > drizzle-kit` | dev/build only, never in the runtime image |

`@xmldom/xmldom` is the entry to revisit first: mammoth parses files an authenticated user
uploads, so it is the only one on the list with an untrusted-input path.

## Log

- 2026-09-04 — list emptied (17 ids removed, 0 added). Waves 1-3 of the 2026-09-02 audit.
