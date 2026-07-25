# SLO: onboarding-first-signal

- **SLO id:** `slo-onboarding-first-signal-data-freshness-1783704663`
- **Service:** `onboarding-first-signal` (onboarding completion → workers pipeline → signals feed)
- **Owner:** zinackes (founder/solo)
- **Created:** 2026-07-10
- **User journey:** A new org completes onboarding and sees its first competitive
  signal in the feed within 10 minutes. This is the landing-page promise this SLO
  protects — the single most important activation moment of the product.

## Target

- **Target: 70% over 28 days** (window_days: 28, rolling)
- Compliance = share of onboarding completions in the window whose org received
  its first signal within 10 minutes of completing onboarding.

### Why 70% and not higher (grounded in measured prod data, 2026-07-10)

- Pre-backfill (before Jul 5), time-to-first-signal p50 was **~20 hours** —
  compliance at a 10-minute threshold was effectively 0%.
- Since Jul 5, the L2 archive backfill (Wayback diff on first scrape) delivers a
  first signal in **2–5 minutes** — but only when the archive has a usable capture
  (best-effort by design: no archive → silent skip).
- **~35% of orgs have never received any signal**, so the hard ceiling today is
  ~65% even with perfect backfill latency. 70% assumes backfill converts part of
  the never-signal cohort; it is a ratchet start, not an endpoint.
- Per SRE Workbook discipline: do not set a target the system has never
  sustained. We have only 5 days of post-backfill data — **recalibrate after the
  first full 28-day window** (early August 2026).

`slo_review.py` will WARN `target_too_low` on this value. Acknowledged: that
heuristic is calibrated for request-serving availability SLOs (99.x%). This is a
low-volume, event-based activation SLI where 70% is the honest, measured start.

### Ratchet plan

| Gate | New target |
|---|---|
| First full 28d window of post-backfill data measured | recalibrate to floor(observed p50 compliance) |
| Never-signal cohort < 15% (coverage work landed) | 85% |
| Two consecutive windows ≥ target with ≥ 20 completions each | +5 pts, cap 95% |

95% is the ceiling, not 99.x: backfill depends on a third party (Wayback
Machine) with no SLA, and some competitor sets legitimately produce no
significant change on day 0.

## SLI

- **Type:** data-freshness (event-based: "did the org's first signal arrive in time?")
- **Numerator:** `count(onboarding completions where min(signals.created_at) per org <= onboarding_sessions.completed_at + interval '10 minutes')`
- **Denominator:** `count(onboarding_sessions where stage = 'completed' and completed_at in window)`
- **Labels:** env=prod, journey=onboarding, promise=first-signal-10min

Definition notes:

- **Backfill signals count.** Archive-origin signals (`filtered_reason =
  'backfill'`, in-app only, "From archive" badge) are real feed entries — the
  promise is "see a signal", not "get an email". They are the main mechanism
  that makes this SLO achievable at all.
- **Denominator is unconditional** — every completed onboarding counts, because
  the landing promise is unconditional. Orgs that selected zero competitors
  still count as misses (that is a product/onboarding-flow problem the SLO
  should surface, not hide).
- One event per completed onboarding session; re-onboarding creates a new event.

### Measurement (Postgres, prod)

Both sides live in the same Neon database (`onboarding_sessions`, `signals`).
Run from `packages/db` against `DATABASE_URL_PROD`:

```sql
WITH completions AS (
  SELECT os.org_id, os.completed_at
  FROM onboarding_sessions os
  WHERE os.stage = 'completed'
    AND os.completed_at >= now() - interval '28 days'
),
first_signal AS (
  SELECT s.org_id, min(s.created_at) AS first_signal_at
  FROM signals s
  GROUP BY s.org_id
)
SELECT
  count(*)                                                          AS completions,
  count(*) FILTER (
    WHERE fs.first_signal_at <= c.completed_at + interval '10 minutes'
  )                                                                 AS within_10min,
  round(
    100.0 * count(*) FILTER (
      WHERE fs.first_signal_at <= c.completed_at + interval '10 minutes'
    ) / greatest(count(*), 1), 1
  )                                                                 AS sli_percent
FROM completions c
LEFT JOIN first_signal fs USING (org_id);
```

## Error budget

- **Budget:** 30% of onboarding completions per 28-day window may miss the
  10-minute mark. At the current volume (roughly N ≈ 20–40 completions per
  window), that is **~6–12 missed completions per window**.
- The time-denominated figure (12,096 budget-minutes / 201.6h) from
  `error_budget_calculator.py` is reported for completeness but is not the
  operative unit — this SLI is event-based, budget is counted in events.

### Alerting — low-traffic adaptation

The standard multi-window burn-rate thresholds computed for 70%/28d are:
fast_burn 13.44 (1h/5m, page), slow_burn 5.6 (6h/30m, page), ticket_burn 0.933
(3d/6h, ticket). **They are not deployed**: at ~1–3 onboardings/day, a 1-hour
rate window contains 0–1 events, so any single miss trips a page — pure noise.
Per the SRE Workbook's low-traffic guidance, alerts are event-count based:

| Alert | Condition | Severity | Rationale |
|---|---|---|---|
| consecutive-miss | 3 consecutive completions miss the 10-min mark | page (Slack ops) | P(3 misses in a row) ≈ 2.7% at 70% compliance → near-certain systemic breakage (Wayback down, backfill job broken, classify wedged, scrape-monitor first-run failing) |
| weekly-degradation | trailing 7d compliance < 50% AND ≥ 5 completions | ticket | trending toward budget exhaustion with a minimum-sample guard |
| window-exhausted | trailing 28d compliance < 70% AND ≥ 10 completions | ticket + policy kicks in | budget spent |

**Implementation (live since 2026-07-10):** piggybacked on the existing
`ops-health-check` cron (*/6h) — `apps/workers/src/lib/slo-first-signal.ts`
computes the SLI (28d + 7d + the 24h coverage companion, logged every run) and
`evaluateFirstSignalAlerts` applies the three conditions above (unit-tested).
Miss root-causing reads the `backfill_runs` analytics table, which records every
backfill outcome bucket (`no_archive_capture` / `no_significant_change` /
`change_triggered` / `error` / preconditions) with a per-cause detail tally.
No Prometheus in this stack; no new cron needed (Trigger.dev schedule cap).

## Error budget policy

When the **window-exhausted** condition fires (trailing 28d compliance < 70%
with ≥ 10 completions):

1. **Freeze** non-reliability changes to the onboarding→first-signal path:
   `backfill-history`, `scrape-monitor` (first-scrape path), `classify-change`,
   `generate-signal`, and onboarding monitor seeding. Reliability fixes only,
   until compliance is back above target for 7 consecutive days.
2. **Root-cause every miss** in the window and bucket it:
   `no_archive_capture` / `backfill_error` / `no_significant_change` /
   `scrape_blocked` / `ai_parse_failed` / `zero_competitors_selected`.
   (`scrape_runs` + `ai_runs` in analytics give most of this per org.)
3. **Route by dominant bucket:** if `no_archive_capture` +
   `no_significant_change` dominate, the fix is coverage work (guaranteed
   day-0 signal artifact), not latency work — prioritize it over roadmap
   features for the next cycle.
4. **Honesty gate:** if two consecutive windows finish out of budget, soften
   the landing-page promise copy ("first signals within minutes" → measured
   claim) until the SLO holds. The marketing claim must not outrun the SLO.

While budget remains: normal feature velocity; misses are logged but do not
gate releases.

## Companion metric (not an SLO yet): signal coverage

The 10-minute SLI conflates **latency** and **coverage**. The ~35%
never-a-signal cohort is a coverage failure and deserves its own tracking:

- **Coverage SLI:** `count(orgs with ≥ 1 signal within 24h of onboarding
  completion) / count(completions)` — same query shape, 24h threshold.
- Track it in the same ops-health-check output. Promote to a full SLO (own
  target + policy) once the primary SLO's first recalibration lands.

## Miss attribution review, 2026-07-25

First post-backfill 28-day window with the miss-attribution join
(`GET /api/admin/first-signal-misses`, plan 019) live. Numbers below are the
production values for the 28-day window ending 2026-07-25.

### SLI

| Metric | Value |
|---|---|
| Completions (10-min window elapsed) | 22 |
| Missed (no signal within 10 minutes) | 16 |
| Never got a signal at all | 5 |
| **SLI (compliance)** | **6/22 = 27%** (target: 70%) |

`missed <= completions` (16 ≤ 22) and `neverSignal <= missed` (5 ≤ 16) both
hold — the numbers are internally consistent.

### Miss buckets (per-org presence, not a partition)

| Bucket | Orgs (of the 16 missed) |
|---|---|
| `no_backfill_run` | 14 |
| `no_archive_capture` | 2 |
| `change_triggered` | 1 |

For reference, every `backfill_runs` row in the same 28 days, across all orgs
(not just the missed ones):

| Outcome | Rows |
|---|---|
| `change_triggered` | 23 |
| `no_archive_capture` | 7 |
| `no_significant_change` | 1 |

### Dominant bucket

`no_backfill_run`, at 14 of 16 missed orgs (88%) — well clear of
`no_archive_capture` (2) and `change_triggered` (1).

### Routing call

Per the error-budget policy's step 3 (line 142): `no_backfill_run` dominant
routes to **wiring**, not coverage. The backfill mechanism itself is healthy —
23 `change_triggered` rows landed in the same 28 days, more than any other
outcome — so this is not the "backfill is dead" case. It simply never ran at
all for 14 of the 16 missed orgs: no `backfill_runs` row exists for any of
their competitors in the window. That points at the backfill never being
triggered (`BACKFILL_ENABLED`, `BACKFILL_SOURCES` scope, monitor seeding not
reaching the first-scrape trigger, or a worker deploy gap), not at a broken
Wayback fetch or an unlucky archive miss. Building the coverage artifact this
SLO doc originally anticipated (`no_archive_capture` +
`no_significant_change` dominant) would not fix this: those two buckets
together are only 3 of 16 misses. The next step is a **separate plan**
scoped to finding why the backfill trigger doesn't fire for most first
scrapes — not designed here.

### Does the 70% target survive?

No — on these numbers the **window-exhausted** alert condition (28d
compliance < 70% with ≥ 10 completions, `docs/slos/onboarding-first-signal.md`
Alerting table) has fired: 27% compliance on 22 completions. That triggers the
error-budget policy's freeze (step 1) and root-causing (step 2, this section).
The **honesty gate** (step 4, soften the landing-page promise copy) requires
two *consecutive* out-of-budget windows before it fires; this is the first
post-backfill 28-day window measured, so the gate has not fired yet on the
data alone — but at 27% against a 70% target it is close enough that the next
window's result should be treated as the deciding one, not a formality.

## Alerts (calculator reference output)

Kept for the record; superseded by the event-based table above.

```
fast_burn   (page):   1h/5m,  burn rate 13.44, 2% of window budget in 1h
slow_burn   (page):   6h/30m, burn rate 5.6,   5% of window budget in 6h
ticket_burn (ticket): 3d/6h,  burn rate 0.933, 10% of window budget in 3d
```

## Review cadence

**Monthly** until the target ratchet stabilizes (first review: after the first
full post-backfill 28-day window, early August 2026), then quarterly. Each
review: recompute the SLI over the closed window, check alert
signal-vs-noise, verify the policy was followed if budget burned, and re-run
`slo_review.py`.
