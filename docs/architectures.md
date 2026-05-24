# Architecture — Outrival

## Domaine métier

| Entité        | Description |
|---------------|-------------|
| Organization  | Workspace d'un utilisateur |
| Competitor    | Entreprise externe surveillée (nom, URL, métadonnées) |
| Monitor       | Config de surveillance d'une source pour un concurrent (type, fréquence) |
| Snapshot      | État capturé d'une source à un instant T (stocké sur R2) |
| Change        | Diff détecté entre deux snapshots (structuré, en Postgres) |
| Signal        | Change classifié par IA avec insight stratégique et sévérité |
| Digest        | Rapport hebdomadaire IA agrégeant les signaux d'une org |
| Alert         | Notification temps-réel déclenchée par un signal critique |
| JobPosting    | Offre d'emploi structurée détectée chez un concurrent |
| Review        | Avis structuré détecté sur G2/Capterra/App Store |

## Stack

| Couche       | Technologie                    | Raison |
|--------------|--------------------------------|--------|
| Frontend     | Next.js 15 App Router          | RSC + streaming, server components natifs |
| UI           | Tailwind v4 + shadcn/ui        | Itération rapide, composants cohérents |
| API          | Hono sur Bun                   | 3-4x plus rapide que NestJS pour CRUD + triggers |
| Auth         | Better Auth                    | Self-hosted, flexible, bon DX |
| ORM          | Drizzle ORM                    | Type-safe, léger, fonctionne Postgres + ClickHouse |
| DB primaire  | PostgreSQL Railway             | Connexions persistantes, même réseau que l'API |
| DB analytics | ClickHouse Cloud               | Requêtes time-series 100x plus rapides que Postgres |
| Stockage     | Cloudflare R2                  | Quasi-gratuit pour snapshots HTML/screenshots |
| Jobs         | Trigger.dev v3                 | Conçu pour scraping lourd, durable execution |
| Scraping     | Crawlee (Apify)                | Anti-fingerprinting, sessions, rotation proxies intégrés |
| Proxy        | ScrapingBee                    | Browser headless managé pour sites protégés anti-bot |
| Discovery    | Exa.ai                         | Recherche sémantique pour trouver des concurrents similaires |
| Cache/PubSub | Upstash Redis                  | Redis serverless pour rate limiting + alertes temps-réel |
| Email        | Resend                         | Emails transactionnels + digests |
| Paiements    | Stripe                         | Abonnements + billing |
| Insights IA  | Claude Sonnet (claude-sonnet-4-6) | Analyse stratégique, digests, battle cards |
| Classification IA | Groq (llama-3.3-70b-versatile) | Classification rapide et cheap des changements |
| Déploiement  | Hetzner VPS + Coolify          | Self-hosted, EU GDPR, €8/mois |

## Infrastructure
Hetzner CX32 (4 vCPU / 8GB RAM / 80GB SSD) — €8/mois
└── Coolify (PaaS self-hosted)
├── @outrival/web    → outrival.io        (:3000)
├── @outrival/api    → api.outrival.io    (:3001)
└── @outrival/workers (Crawlee + Trigger.dev runner)
Railway EU — ~$10/mois
└── PostgreSQL (base de données principale)
ClickHouse Cloud (EU) — €0 free tier → €20/mois à l'échelle
└── Données time-series
Cloudflare R2 — ~€1/mois
└── Snapshots HTML, screenshots, diffs visuels
Upstash Redis — €0-10/mois
└── Rate limiting, pub/sub alertes, cache
Trigger.dev Cloud — €0 free tier → €50/mois à l'échelle
└── Orchestration jobs (scraping, digests, alertes)

## Schéma PostgreSQL (tables principales)

```sql
organizations    id, name, slug, plan, stripe_customer_id, created_at
users            id, org_id, email, name, role, created_at
sessions         id, user_id, token, expires_at (Better Auth géré)

competitors      id, org_id, name, url, description, overlap_score,
                 category, founded_year, funding_stage, metadata_json,
                 created_at, updated_at

monitors         id, competitor_id, source_type, frequency,
                 config_json, is_active, last_run_at, next_run_at

snapshots        id, monitor_id, r2_key, content_hash,
                 scraped_at, status (success|failed|partial)

changes          id, monitor_id, snapshot_before_id, snapshot_after_id,
                 diff_text, diff_type, raw_diff_json, detected_at

signals          id, change_id, org_id, competitor_id,
                 severity (low|medium|high|critical),
                 category (pricing|product|hiring|reviews|content|funding),
                 insight, so_what, recommended_action,
                 is_read, created_at

digests          id, org_id, week_start, week_end,
                 content_json, temperature, sent_at, created_at

alerts           id, signal_id, org_id, channel (email|slack|webhook),
                 sent_at, error

job_postings     id, competitor_id, title, department, location,
                 url, detected_at, closed_at, is_active

reviews          id, competitor_id, source (g2|capterra|appstore|playstore),
                 score, content, author, detected_at
```

## Schéma ClickHouse (time-series)

```sql
pricing_history  competitor_id, plan_name, price, currency,
                 billing_period, recorded_at

job_counts       competitor_id, department, count, recorded_at

review_scores    competitor_id, source, score, review_count,
                 sentiment_score, recorded_at

signal_feed      org_id, competitor_id, category, severity,
                 recorded_at
```

## Structure R2
snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.html
snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.png
diffs/{change_id}/before.png
diffs/{change_id}/after.png

## Types de sources (monitor.source_type)
homepage | pricing | blog | changelog | jobs
g2_reviews | capterra_reviews | appstore_reviews
linkedin | twitter

## Pipeline IA
Change détecté
↓
Groq llama-3.3-70b  →  classify: category + severity + is_significant
↓ si is_significant = true
Claude Sonnet 4.6   →  generate: insight + so_what + recommended_action
↓
Signal stocké en DB
↓ si severity IN (high, critical)
Upstash pub/sub  →  Slack webhook / email Resend

## Variables d'environnement requises

```bash
DATABASE_URL=               # PostgreSQL Railway
CLICKHOUSE_URL=             # ClickHouse Cloud HTTP endpoint
CLICKHOUSE_PASSWORD=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=outrival-snapshots
BETTER_AUTH_SECRET=         # 32+ chars random
BETTER_AUTH_URL=            # https://api.outrival.io
TRIGGER_SECRET_KEY=
SCRAPINGBEE_API_KEY=
EXA_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_API_URL=        # https://api.outrival.io
```