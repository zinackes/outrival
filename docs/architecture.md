# Architecture — Outrival

Source unique de vérité pour la stack, le domaine, le schéma DB et le pipeline.
Mise à jour à chaque phase / patch.

## Domaine métier

| Entité                | Description |
|-----------------------|-------------|
| Organization          | Workspace d'un utilisateur (plan, billing, productProfile, settings notifications) |
| User                  | Utilisateur d'une org (Better Auth gère sessions/accounts/verifications) |
| Competitor            | Entreprise externe surveillée + résumé IA |
| Monitor               | Config de surveillance d'une source (type, fréquence, requiresProxy, lastChangedAt, nextRunAt) |
| Snapshot              | État capturé d'une source à un instant T (HTML stocké sur R2) |
| Change                | Diff détecté entre deux snapshots (texte tronqué 50KB + rawDiff jsonb) |
| Signal                | Change classifié par IA avec insight stratégique et sévérité |
| Digest                | Rapport hebdomadaire IA agrégeant les signaux d'une org |
| Alert                 | Notification temps-réel envoyée par email/Slack/webhook |
| Notification          | Notification in-app temps-réel via SSE (DB-backed) |
| JobPosting            | Offre d'emploi structurée détectée chez un concurrent |
| Review                | Praise/complaint extraite de G2, Capterra, App Store |
| BattleCard            | Fiche stratégique IA exportable en PDF (sections jsonb editables) |
| CompetitorCandidate   | Concurrent suggéré à valider — détecté chaque semaine (Exa, `source=detection`) ou sauvé depuis la découverte d'onboarding non sélectionnée (`source=onboarding`) |

## Stack

| Couche            | Technologie                              | Raison |
|-------------------|------------------------------------------|--------|
| Frontend          | **Next.js 16** App Router + React 19     | RSC + streaming, server components natifs |
| UI                | Tailwind v4 + shadcn/ui new-york         | Itération rapide, composants cohérents |
| API               | Hono sur Bun                             | 3-4× plus rapide que NestJS pour CRUD + triggers |
| Auth              | Better Auth v1.6                         | Self-hosted, flexible, bon DX |
| ORM               | Drizzle ORM                              | Type-safe, léger, Postgres + ClickHouse |
| DB primaire       | PostgreSQL (Railway)                     | Connexions persistantes, même réseau que l'API |
| DB analytics      | ClickHouse Cloud                         | Time-series 100× plus rapide que Postgres |
| Stockage binaire  | Cloudflare R2                            | Quasi-gratuit pour snapshots HTML/screenshots/PDFs |
| Jobs              | **Trigger.dev v4** Cloud                 | Durable execution, retries, dashboard, schedules |
| Scraping          | Crawlee (Playwright + Cheerio)           | Anti-fingerprinting, sessions, retries intégrés |
| Proxy fallback    | ScrapingBee (`premium_proxy`)            | Browser managé pour sites protégés anti-bot |
| Discovery         | Exa.ai (`exa-js`)                        | Recherche sémantique de concurrents similaires |
| Email             | Resend                                   | Alerts + digests transactionnels |
| Paiements         | Stripe (SDK v22)                         | Checkout + Customer Portal + webhooks |
| Insights IA       | Groq (`llama-3.3-70b-versatile`)         | Pipeline complet — abstraction provider, swap Claude = 1 ligne |
| Déploiement       | Hetzner VPS + Coolify                    | Self-hosted, EU GDPR, €8/mois |

> **Note** : Upstash Redis a été retiré du stack (Phase 6). Les alertes temps-réel
> passent par SSE DB-backed (poll Postgres 3s + heartbeat), latence ~3s suffisante
> pour de la veille. À ré-introduire uniquement si besoin de rate-limiting API.

## Infrastructure

```
Hetzner CX32 (4 vCPU / 8GB RAM / 80GB SSD) — €8/mois
└── Coolify (PaaS self-hosted)
    ├── @outrival/web    → outrival.io        (:3000) Next.js 16
    ├── @outrival/api    → api.outrival.io    (:3001) Hono + Bun
    └── @outrival/workers (runner Trigger.dev local — dev only)

Railway EU — ~$10/mois
└── PostgreSQL (base de données principale)

ClickHouse Cloud (EU) — €0 free tier → €20/mois à l'échelle
└── Time-series (pricing_history, job_counts, review_scores, signal_feed)

Cloudflare R2 — ~€1/mois
└── Snapshots HTML, screenshots, PDFs battle cards

Trigger.dev Cloud — €0 free → Hobby €20/mois (50k runs) → Pro €100
└── Orchestration jobs (scraping, classify, insight, digest, alerts, battle cards)

ScrapingBee — $49/mois (100k crédits) — fallback uniquement (direct-first)
Resend — $20/mois Pro (50k emails/mois)
Stripe — % par transaction
Exa.ai — pay-per-search (discovery hebdomadaire)
Groq — $0.59/M tokens input, $0.79/M tokens output (llama-3.3-70b)
```

**Total estimé à l'échelle (~50 orgs actives)** : €120-180/mois infra + variable IA/scraping.

## Schéma PostgreSQL (tables principales)

### Auth (Better Auth gère ses propres tables)
```
user, session, account, verification
```

### Domaine
```sql
organizations          id, name, slug, plan, stripe_customer_id, stripe_subscription_id,
                       plan_period, slack_webhook_url, digest_email, digest_enabled,
                       alerts_enabled, product_url, product_profile (jsonb),
                       onboarding_completed, created_at, updated_at

competitors            id, org_id, name, url, description, overlap_score, category,
                       metadata (jsonb), ai_summary, ai_summary_updated_at,
                       created_at, updated_at, deleted_at

monitors               id, competitor_id, source_type, frequency, config (jsonb),
                       is_active, requires_proxy, last_run_at, next_run_at,
                       last_changed_at, created_at

snapshots              id, monitor_id, r2_key, content_hash, scraped_at,
                       status (success|failed|partial)

changes                id, monitor_id, snapshot_before_id, snapshot_after_id,
                       diff_text (50KB max), raw_diff (jsonb), detected_at

signals                id, change_id (unique), org_id, competitor_id,
                       severity (low|medium|high|critical),
                       category (pricing|product|hiring|reviews|content|funding),
                       insight, so_what, recommended_action, is_read, created_at

digests                id, org_id, week_start, week_end, content (jsonb),
                       temperature, sent_at, created_at

alerts                 id, signal_id, org_id, channel (email|slack|webhook),
                       sent_at, error

notifications          id, org_id, type (signal|new_competitor), title, body,
                       link_url, is_read, created_at

job_postings           id, competitor_id, title, department, location, url,
                       detected_at, closed_at, is_active

reviews                id, competitor_id, source (g2|capterra|appstore|playstore),
                       score, content, author (praise|complaint|<name>),
                       detected_at

battle_cards           id, competitor_id (unique), status (pending|generating|ready|failed),
                       content (jsonb — 6 sections editables), pdf_r2_key,
                       generated_at, updated_at

competitor_candidates  id, org_id, url, title, overlap_score, reason,
                       status (new|dismissed|added),
                       source (detection|onboarding), first_seen_at
```

### Enums Postgres
```
plan              free | starter | pro | business
billing_period    monthly | yearly
source_type       homepage | pricing | blog | changelog | jobs |
                  g2_reviews | capterra_reviews | appstore_reviews |
                  linkedin | twitter | github_repo
frequency         realtime | daily | weekly
signal_severity   low | medium | high | critical
signal_category   pricing | product | hiring | reviews | content | funding
notification_type signal | new_competitor
candidate_status  new | added | dismissed
candidate_source  detection | onboarding
battle_card_status pending | generating | ready | failed
```

## Schéma ClickHouse (time-series, ENGINE = MergeTree)

```sql
pricing_history     competitor_id, plan_name, price, currency, billing_period, recorded_at
job_counts          competitor_id, department, count, recorded_at
review_scores       competitor_id, source, score, review_count, sentiment_score, recorded_at
signal_feed         org_id, competitor_id, category, severity, recorded_at
```

**Pattern d'accès** :
- Client partagé via `packages/db/src/clickhouse.ts` (proxy lazy `ch`)
- Inserts depuis workers via `apps/workers/src/lib/clickhouse.ts` (best-effort + logger)
- Queries depuis API via `apps/api/src/lib/clickhouse-safe.ts` (return `[]` si CH down,
  bordé par `request_timeout` 8s + race 10s → jamais de hang sur le handler si CH lent/froid)
- Service maintenu chaud par le cron `keep-clickhouse-warm` (SELECT 1 toutes les 5 min)
  pour éviter le cold-start ~30s du free tier qui faisait ramer les tabs pricing/hiring/reviews
- Tables créées via `pnpm --filter @outrival/db ch:setup` (one-shot post-provisioning)

## Structure R2
```
snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.html
snapshots/{competitor_id}/{source_type}/{ISO_timestamp}.png
battle-cards/{competitor_id}/{ISO_timestamp}.pdf
diffs/{change_id}/before.png      (futur — Phase 8+)
diffs/{change_id}/after.png       (futur — Phase 8+)
```

## Plans & gating

Source unique : `packages/shared/src/constants/plans.ts` — `PLAN_LIMITS` lu par
API gating, web UI, paywalls, et workers (send-alert).

| Plan      | Max concurrents | Sources                                                | Fréquence min | Channels                | Features |
|-----------|-----------------|--------------------------------------------------------|---------------|-------------------------|----------|
| free      | 2               | homepage, pricing, blog                                | weekly        | email                   | —        |
| starter   | 5               | + jobs                                                 | daily         | + slack                 | —        |
| pro       | 15              | + g2_reviews, capterra_reviews                         | realtime      | + webhook               | battleCards, realtimeAlerts |
| business  | ∞               | + appstore_reviews                                     | realtime      | email + slack + webhook | + api, multiUser |

Codes d'erreur structurés sur les routes gating : `plan_limit_competitors`,
`plan_locked_feature`, `plan_locked_source`, `plan_locked_frequency`,
`plan_locked_channel`. Le web parse via `paywallFromError(err)` et affiche
`<PaywallDialog>`.

## Provisioning des monitors

Un competitor n'a pas automatiquement un monitor par source. Trois chemins de création :

- **Création manuelle** (`POST /api/competitors`) et **ajout depuis candidate**
  (`candidates.ts`) → sèment uniquement `homepage` (daily), `pricing` (daily),
  `blog` (weekly). Sources figées, non gated (toutes incluses dès le plan free).
- **Onboarding** (`POST /api/onboarding/complete`) → sème les sources choisies par
  l'utilisateur, gated par plan (`isSourceAllowed` → `plan_locked_source`).
- **Enable à la demande** (`POST /api/competitors/:id/monitors`) → ajoute une source
  (`jobs`, `g2_reviews`, `capterra_reviews`, …) à un competitor existant. Gated par
  plan (sinon `plan_locked_source` → paywall), idempotent (1 monitor par
  `(competitor, sourceType)`), fréquence par défaut `weekly` pour les reviews /
  `daily` sinon, clampée à une fréquence autorisée par le plan.

### Self-product (« My Product ») — patch-15

Le competitor `type = "self"` (le produit de l'utilisateur) est créé à
l'onboarding complete **quel que soit le stade**, plus seulement quand il y a une
URL live. `competitors.url` est donc **nullable** (un produit idée/document/dev n'a
pas de site). Les monitors dépendent de ce qu'on peut réellement observer :

- `live` (URL site) → `homepage` + `pricing` + `jobs` (reviews jamais, cf. patch-12).
- `developing` (repo GitHub, `organizations.product_repo_url`) → source `github_repo`,
  l'URL repo vivant dans `monitor.config.url`. Le « scraper » lit l'API REST GitHub
  (description + dernière release + commits récents) et synthétise un document passé
  au pipeline générique snapshot→diff→change→classify→signal (pas de Crawlee).
- `idea` / `document` → aucun monitor : le self existe pour l'édition **manuelle** du
  profil uniquement.

Activation a posteriori (passage en prod, ou ajout d'un repo) sans re-onboarder :
`POST /api/my-product/site` (pose l'URL + sème les monitors site) et
`POST /api/my-product/repo` (pose/maj le repo + monitor `github_repo`).

Côté web, l'état vide d'un onglet (Hiring, Reviews…) sans monitor affiche un bouton
**"Enable … monitoring"** qui appelle cet endpoint puis déclenche le premier scrape.

## Pipeline data (de bout en bout)

```
[cron horaire] schedule-scraping
  └─ enqueue monitors où isActive && (nextRunAt null || nextRunAt <= now)

[par monitor] scrape-monitor
  └─ direct-first via Crawlee (Playwright/Cheerio)
       └─ si looksBlocked → fallback ScrapingBee + monitor.requiresProxy = true
  └─ upload R2 (toujours AVANT insert DB)
  └─ insert snapshot
  └─ si hash changé : insert change → trigger classify-change
  └─ routing par sourceType :
       pricing → extract-pricing → ClickHouse pricing_history
       jobs    → extract-jobs    → diff actives + ClickHouse job_counts
       g2/capt → extract-reviews → praises/complaints + ClickHouse review_scores
  └─ reschedule : computeNextRun(frequency, lastChangedAt, createdAt)
       (multiplicateur ×1 / ×2 / ×3 / ×4 selon staleness — plafond MAX_INTERVAL)

[par change] classify-change (Groq llama-3.3-70b)
  └─ category + severity + isSignificant
  └─ si significant → trigger generate-signal

[par signal candidat] generate-signal (Groq)
  └─ insight + so_what + recommended_action
  └─ insert signal (idempotent par changeId)
  └─ insert ClickHouse signal_feed (best-effort)
  └─ si severity ∈ {high, critical} → trigger send-alert

[par signal critique] send-alert
  └─ insert notification (in-app, si realtimeAlerts dans le plan)
  └─ Slack webhook (si plan + url configurée)
  └─ Email Resend (toujours, sauf erreur)
  └─ insert alerts row (avec error si échec)

[cron lundi 8h UTC] generate-weekly-digest
  └─ idempotent par (orgId, weekStart)
  └─ skip orgs sans signal de la semaine
  └─ Groq insight global → HTML inline → Resend

[cron dimanche 20h UTC] detect-new-competitors
  └─ par org onboardée : Exa findSimilar + scoreOverlap (batché)
  └─ dedup URL exacte + hostname normalisé
  └─ si overlap > 65 → insert candidate + notification "new_competitor"

[on-demand] generate-battle-card
  └─ gather context (productProfile, aiSummary, top reviews, recent signals)
  └─ Groq battle card 6 sections → upsert content
  └─ Playwright headless → page.pdf({format:"A4"}) → R2

[cron */5 min] keep-clickhouse-warm
  └─ SELECT 1 best-effort → empêche le cold-start du free tier CH
     (sinon 1ère lecture pricing/hiring/reviews ~30s)
```

## Temps-réel : SSE DB-backed

Route Hono `GET /api/notifications/stream` (auth required) :
- `streamSSE` natif Hono, poll DB 3s + heartbeat
- `onAbort` cleanup, EventSource auto-reconnect côté client
- Composant `<NotificationsBell />` dans le header du dashboard
- Pattern : ~3s de latence, gratuit, scale sur le VPS jusqu'à ~1000 connexions simultanées
- Au-delà : passer à Upstash pub/sub ou un service WebSocket dédié (Phase 9+)

## Variables d'environnement

```bash
# DB
DATABASE_URL=                # PostgreSQL Railway
CLICKHOUSE_URL=              # ClickHouse Cloud HTTP endpoint (best-effort)
CLICKHOUSE_PASSWORD=

# Storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=outrival-snapshots

# Auth
BETTER_AUTH_SECRET=          # 32+ chars random
BETTER_AUTH_URL=             # https://api.outrival.io

# Jobs
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_ID=

# Scraping & discovery
SCRAPINGBEE_API_KEY=         # fallback only (direct-first)
EXA_API_KEY=

# AI
ANTHROPIC_API_KEY=           # provider abstrait — Claude fallback
GROQ_API_KEY=                # primary provider

# Notifications
RESEND_API_KEY=

# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_YEARLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_BUSINESS_MONTHLY=
STRIPE_PRICE_BUSINESS_YEARLY=

# Public
NEXT_PUBLIC_API_URL=         # https://api.outrival.io
WEB_URL=                     # https://outrival.io (callbacks Stripe)
```

## Décisions architecturales clés

- **Pipeline IA 100% Groq** par défaut (rapide + cheap). Provider abstrait dans
  `packages/ai/src/provider.ts` → swap Claude Sonnet = 1 ligne dans `config.ts`.
- **Direct-first scraping** : tentative gratuite Playwright avant fallback ScrapingBee.
  Apprentissage `monitor.requiresProxy` pour ne pas re-tenter le direct sur un site connu protégé.
- **Reschedule adaptatif** : `computeNextRun()` dans `@outrival/shared` ralentit
  les monitors stables (×4 max). La fréquence utilisateur = plafond, pas valeur fixe.
- **ClickHouse best-effort** : si `CLICKHOUSE_URL` absent, on log + skip. Permet de
  développer/tester sans provisioner.
- **R2 avant DB** systématique pour les snapshots : si upload R2 fail, on throw →
  retry Trigger.dev, pas de row orpheline.
- **Idempotence Signal** : check `signals.changeId` (unique) dans BOTH `classify-change`
  ET `generate-signal` (protège des races).
- **SSE DB-backed** plutôt qu'Upstash pub/sub : latence 3s ok pour veille, gratuit, scale VPS.
- **Discovery synchrone** (Phase 4) : appels <15s, pas de Trigger.dev Realtime (gratuit + simple).
- **Subpath exports** `@outrival/scrapers/{discovery,quick-fetch}` pour ne pas
  pull crawlee/playwright dans l'API.

## Roadmap (post-MVP)

- Phase 8 : Diffs visuels (screenshot before/after + heatmap)
- Phase 9 : LinkedIn + Twitter scrapers (volumétrie : SSE → WebSocket dédié)
- Phase 10 : Multi-user orgs (RBAC, invitations) — feature `multiUser` business
- Phase 11 : API publique — feature `api` business
- Phase 12 : Auto-discovery URL G2/Capterra (heuristique nom + slug)
