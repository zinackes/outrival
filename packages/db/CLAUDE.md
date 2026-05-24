# @outrival/db — Drizzle ORM

Stack : Drizzle ORM, PostgreSQL (Railway), ClickHouse Cloud

## Conventions
- Schema : un fichier par entité dans src/schema/[entity].ts
- Toujours exporter le type inféré : export type X = InferSelectModel<typeof xTable>
- Migrations via drizzle-kit — jamais de SQL manuel
- Pas de logique métier dans ce package — uniquement schema + queries

## Décision Postgres vs ClickHouse
- Postgres : users, orgs, competitors, monitors, snapshots, changes, signals, digests, alerts
- ClickHouse : pricing_history, job_counts, review_scores, signal_feed
- Règle : si on a besoin d'un timestamp ET qu'on va requêter par période → ClickHouse