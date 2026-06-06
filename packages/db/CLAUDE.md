# @outrival/db — Drizzle ORM

Stack : Drizzle ORM, PostgreSQL (Neon)

## Conventions
- Schema : un fichier par entité dans src/schema/[entity].ts
- Toujours exporter le type inféré : export type X = InferSelectModel<typeof xTable>
- Migrations via drizzle-kit — jamais de SQL manuel
- Pas de logique métier dans ce package — uniquement schema + queries

## Modèle de données — une seule base Postgres (Neon)
- Relationnel : users, orgs, competitors, monitors, snapshots, changes, signals, digests, alerts
- Time-series / analytics (ex-ClickHouse) : `src/schema/analytics.ts` —
  pricing_history, job_counts, review_scores, signal_feed, scrape_runs, ai_runs,
  extraction_runs, numeric_claims, tech_stack_history, platform_detection_runs.
  Tables append-only sans FK (best-effort logging), index sur (competitor_id,
  recorded_at) / (recorded_at). Écrites par `apps/workers/src/lib/analytics.ts`,
  lues par `apps/api/src/lib/analytics-safe.ts`.