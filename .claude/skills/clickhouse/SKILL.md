---
name: clickhouse
description: >
  DEPRECATED. ClickHouse a été retiré d'Outrival — les time-series / analytics
  vivent désormais dans Postgres (Neon). Lire ce fichier si du vieux code ou des
  specs mentionnent encore ClickHouse, pour savoir où ça a migré.
allowed-tools: [Read, Write, Edit]
---

# ClickHouse — RETIRÉ (migré vers Postgres / Neon)

ClickHouse n'est plus utilisé. Toutes les tables time-series / analytics sont
des tables Postgres ordinaires dans la **même base Neon** que le relationnel.
Ne plus écrire de code ClickHouse, ne plus ajouter `@clickhouse/client`.

## Où ça vit maintenant

- **Schéma** : `packages/db/src/schema/analytics.ts` — tables append-only sans FK
  (pricing_history, job_counts, review_scores, signal_feed, scrape_runs, ai_runs,
  extraction_runs, numeric_claims, tech_stack_history, platform_detection_runs),
  index sur `(competitor_id, recorded_at)` / `(recorded_at)`. Créées par `db:push`.
- **Écriture (workers)** : `apps/workers/src/lib/analytics.ts` — helpers best-effort
  (`insertPricingHistory`, `logScrapeRun`, `logAiRun`, `loggedAi`, …) via Drizzle.
  Une erreur de logging ne casse jamais un scrape / un job IA.
- **Lecture (API)** : `apps/api/src/lib/analytics-safe.ts` — `analyticsQuery(sql)`,
  best-effort (`[]` en cas d'erreur). SQL Postgres standard (`count(*) filter (…)`,
  `distinct on`, `make_interval`, window functions).

## Règle de modélisation

Une donnée horodatée requêtée par période = une table append-only dans
`analytics.ts` (pas de FK pour préserver le best-effort), écrite via
`lib/analytics.ts`, lue via `lib/analytics-safe.ts`. Tout le reste = schéma
relationnel normal (`src/schema/<entity>.ts`).
