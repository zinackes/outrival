---
name: clickhouse
description: >
  Utiliser quand on écrit des requêtes analytiques ou qu'on interagit
  avec ClickHouse Cloud dans Outrival. Contient le schema, les patterns
  de connexion et les requêtes communes.
allowed-tools: [Read, Write, Edit]
---

# ClickHouse — Outrival

## Quand utiliser ClickHouse vs PostgreSQL

ClickHouse : pricing_history, job_counts, review_scores, signal_feed
  → Toute donnée avec un timestamp qu'on va requêter par période
  → Aggregations sur grandes quantités de lignes
  → Graphiques et timelines dans l'UI

PostgreSQL : tout le reste (users, competitors, monitors, snapshots, changes, signals, digests)

## Client

```typescript
// packages/db/src/clickhouse.ts
import { createClient } from "@clickhouse/client";

export const ch = createClient({
  url: process.env.CLICKHOUSE_URL,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: "outrival",
});
```

## Requêtes communes

### Historique de prix d'un concurrent
```typescript
const rows = await ch.query({
  query: `
    SELECT plan_name, price, currency, recorded_at
    FROM pricing_history
    WHERE competitor_id = {competitorId: String}
    ORDER BY recorded_at DESC
    LIMIT 100
  `,
  query_params: { competitorId },
  format: "JSONEachRow",
});
const data = await rows.json();
```

### Trend des offres d'emploi par département (30 derniers jours)
```typescript
const rows = await ch.query({
  query: `
    SELECT department, count, recorded_at
    FROM job_counts
    WHERE competitor_id = {competitorId: String}
      AND recorded_at >= now() - INTERVAL 30 DAY
    ORDER BY recorded_at ASC
  `,
  query_params: { competitorId },
  format: "JSONEachRow",
});
```

### Score moyen des reviews ce mois
```typescript
const rows = await ch.query({
  query: `
    SELECT source, avg(score) as avg_score, sum(review_count) as total_reviews
    FROM review_scores
    WHERE competitor_id = {competitorId: String}
      AND recorded_at >= toStartOfMonth(now())
    GROUP BY source
  `,
  query_params: { competitorId },
  format: "JSONEachRow",
});
```

## Insert

```typescript
await ch.insert({
  table: "pricing_history",
  values: [{
    competitor_id: competitorId,
    plan_name: "Pro",
    price: 59,
    currency: "EUR",
    billing_period: "monthly",
    recorded_at: new Date(),
  }],
  format: "JSONEachRow",
});
```

## Important

- ClickHouse est append-only — pas d'UPDATE ni de DELETE en usage normal
- Les timestamps doivent être des objets Date (pas des strings ISO)
- Toujours utiliser query_params pour éviter les injections SQL
- Les noms de colonnes sont snake_case