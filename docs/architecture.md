# Architecture — Outrival

Source unique de vérité pour la stack, le domaine, le schéma DB et le pipeline.
Mise à jour à chaque phase / patch.

## Domaine métier

| Entité                | Description |
|-----------------------|-------------|
| Organization          | Workspace d'un utilisateur (plan, billing, productProfile, settings notifications) |
| User                  | Utilisateur d'une org (Better Auth gère sessions/accounts/verifications) |
| Competitor            | Entreprise externe surveillée + résumé IA |
| Monitor               | Config de surveillance d'une source (type, fréquence, requiresLevel, lastChangedAt, nextRunAt) |
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
| TechStackEntry        | Technologie tierce détectée chez un concurrent (paiements, CRM, analytics…) via headers/scripts/DOM/footer — scraper mensuel indépendant (patch-18) |

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
| Scraping          | Patchright (stealth Chromium) + fetch    | Drop-in Playwright, patches CDP/webdriver — passe Cloudflare au niveau navigateur (patch-20) |
| Proxy cascade     | ProxyScrape (datacenter→residential) + Camoufox | Cascade 5 niveaux découplée (fingerprint vs IP), pas de coût par requête (patch-20) |
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

ProxyScrape — datacenter ~$10/mois (flat, BW illimitée) + residential pay-per-GB (~$15-30/mois total, patch-20)
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
                       is_active, requires_level (0|1|2|3|4|null — patch-20),
                       requires_level_since, requires_level_last_reprobe,
                       consecutive_failures, marked_unscrapable, last_run_at, next_run_at,
                       last_changed_at, created_at

snapshots              id, monitor_id, r2_key, content_hash, scraped_at,
                       status (success|failed|partial), etag, last_modified,
                       resolved_url, homepage_structure (jsonb — patch-16, homepage only),
                       screenshot_phash (hex dHash — patch-17), content_size (patch-17)

changes                id, monitor_id, snapshot_before_id, snapshot_after_id,
                       diff_text (50KB max), diff_type (text|structured),
                       raw_diff (jsonb), structured_diff (jsonb — patch-16),
                       summary, detected_at

signals                id, change_id (unique), org_id, competitor_id,
                       severity (low|medium|high|critical),
                       category (pricing|product|hiring|reviews|content|funding),
                       insight, so_what, recommended_action,
                       human_change_before, human_change_after,
                       narrative (patch-16), is_read, created_at

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

battle_cards           id, competitor_id (unique), org_id, content (jsonb — 6 sections
                       editables), pdf_r2_key, flagged_for_regeneration_at (patch-21),
                       based_on_user_update_at, based_on_competitor_signal_at (patch-22 —
                       staleness : inputs au moment de générer), generated_at, updated_at

competitor_candidates  id, org_id, url, title, overlap_score, reason,
                       status (new|dismissed|added),
                       source (detection|onboarding), first_seen_at

discovery_runs         id, org_id, last_discovery_at, based_on_profile_update_at
                       — patch-22, staleness discovery on-demand (1 ligne/org, upsert sur /detect)

audit_log              id, actor_email, action (view_user|force_scrape|update_feedback),
                       target_type, target_id, metadata (jsonb), created_at   — ops (patch-02)

volatile_lines         id, monitor_id, pattern (normalized line signature),
                       change_count, stable_count, is_volatile, last_seen_at
                       — patch-17, unique (monitor_id, pattern), homepage churn learning
tech_stack_entries     id, competitor_id, tech_id, tech_name, category, importance,
                       evidence (jsonb), first_detected_at, last_detected_at, is_active
                       — patch-18, unique (competitor_id, tech_id), present tech stack state

competitors            + tech_stack_scraped_at (patch-18 — cadence du scraper tech-stack
                       mensuel indépendant ; pas de monitor, cf. pipeline)
```

### Enums Postgres
```
plan              free | starter | pro | business
billing_period    monthly | yearly
source_type       homepage | pricing | blog | changelog | jobs |
                  g2_reviews | capterra_reviews | appstore_reviews |
                  linkedin | twitter | github_repo | tech_stack
                  (tech_stack = ancrage infra patch-18, monitor isActive=false,
                   jamais exposé dans la liste Sources — voir pipeline. Le tech
                   stack détecté est lui surfacé en lecture seule via un tab dédié
                   sur la fiche competitor.)
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
scrape_runs         monitor_id, competitor_id, source_type, status (success|no_change|
                    failed), level (0-4 cascade — patch-20), attempts, failure_reason,
                    duration_ms, recorded_at  — ops (patch-02/20)
ai_runs             task (classify|classify_structured|narrate_change|insight|digest|
                    battle_card|extract_pricing|extract_jobs|extract_reviews|
                    extract_self_profile|source_summary|competitor_summary|…),
                    provider, model,
                    status (success|parse_failed|error), recorded_at      — ops (patch-02)
numeric_claims      competitor_id, monitor_id, pattern (user_count|uptime|scale|…),
                    unit, context, value, raw_text, observed_at          — patch-17
tech_stack_history  competitor_id, tech_id, event (appeared|disappeared),
                    importance, recorded_at                              — patch-18
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
  au pipeline générique snapshot→diff→change→classify→signal (pas la cascade navigateur).
- `idea` / `document` → aucun monitor : le self existe pour l'édition **manuelle** du
  profil uniquement.

Activation a posteriori (passage en prod, ou ajout d'un repo) sans re-onboarder :
`POST /api/my-product/site` (pose l'URL + sème les monitors site) et
`POST /api/my-product/repo` (pose/maj le repo + monitor `github_repo`).

Côté web, l'état vide d'un onglet (Hiring, Reviews…) sans monitor affiche un bouton
**"Enable … monitoring"** qui appelle cet endpoint puis déclenche le premier scrape.

Le profil (`category`/`audience`/`valueProp` + `features`/`techStack`) est ré-extrait
de la homepage à chaque scrape par `extract-self-profile` (auto-détecté rafraîchi,
champs édités à la main restent sticky). `POST /api/my-product/rescan` accepte un body
optionnel `{ categories?: ("profile"|"pricing"|"features"|"techStack")[] }` : sans
body → re-scrape tous les monitors ; avec catégories → seulement les sources
correspondantes (profile/features/techStack → `homepage` dédupliqué, pricing →
`pricing`). Un re-scan forcé bypasse la dédup par content-hash → ré-extrait même si la
page n'a pas changé. Côté web, le bouton **Re-scan** ouvre un menu de sélection par
carte (état live uniquement).

## Pipeline data (de bout en bout)

```
[cron horaire] schedule-scraping
  └─ enqueue monitors où isActive && (nextRunAt null || nextRunAt <= now)

[par monitor] scrape-monitor
  └─ cascade 5 niveaux (patch-20) via scrapePage : L0 fetch direct → L1 Patchright
       sans proxy → L2 Patchright+datacenter → L3 Patchright+residential → L4 Camoufox
       └─ escalade UNIQUEMENT sur blocage (403/503/challenge/soft_block/needs_render),
          pas sur timeout ; routage par type d'échec (IP→proxy, render→navigateur)
       └─ apprentissage monitor.requiresLevel (0-4|null) + re-probe depuis L0 à 14j ;
          3 échecs consécutifs (jusqu'à L4) → monitor.markedUnscrapable
       └─ homepage (patch-16) : scroll progressif (path direct) → lazy content sous la fold
       └─ anti-vide (patch-17) : isContentCollapsed (vide absolu) + garde médiane des 5
          derniers content_size (soft-block) → throw/retry ; ne masque pas une vraie réduction
  └─ upload R2 (toujours AVANT insert DB)
  └─ insert snapshot (homepage → + homepage_structure jsonb patch-16, + screenshot_phash
       + content_size patch-17)
  └─ diff :
       homepage + 2 structures → diff STRUCTURÉ (diffHomepages) ; enrichissements patch-17
         (poussés dans structuredChanges) : visual_redesign (pHash), numeric_claim_changed
         (claims → ClickHouse numeric_claims), customer_logo_+/- , testimonial_+/- (stable 6
         scrapes, carousel-safe) ; apprentissage volatile (volatile_lines) filtre la churn ;
         SCORE DE PERTINENCE filtre < 0.5 (silence) ; si [] / tout silencé → aucun change/signal ;
         sinon insert change (diff_type="structured") → classify-change
       sinon / homepage sans structure précédente (pre-patch) → diff lexical (fallback)
       si change : trigger classify-change
  └─ routing par sourceType :
       pricing → extract-pricing → ClickHouse pricing_history
       jobs    → extract-jobs    → diff actives + ClickHouse job_counts
       g2/capt → extract-reviews → praises/complaints + ClickHouse review_scores
  └─ reschedule : computeNextRun(frequency, lastChangedAt, createdAt)
       (multiplicateur ×1 / ×2 / ×3 / ×4 selon staleness — plafond MAX_INTERVAL)

[par change] classify-change (Groq llama-3.3-70b)
  └─ lexical → classifyChange (8b) ; structuré (patch-16) → classifyStructuredChanges
       (70b, caché) = overallSeverity + category + perChangeAssessment (significance/change)
  └─ category + severity + isSignificant ; perChange réécrit changes.structured_diff
  └─ si significant → trigger generate-signal

[par signal candidat] generate-signal (Groq)
  └─ insight + so_what + recommended_action
  └─ patch-16 : si change structuré + severity ≥ HOMEPAGE_NARRATIVE_MIN_SEVERITY (medium)
       → narrate_change (70b, non caché, best-effort) → signals.narrative
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

[cron */6h] ops-health-check (patch-02)
  └─ seuils conservateurs sur scrape_runs / ai_runs / signal_feed (gardes
     d'échantillon min anti alert-fatigue) → 1 message OPS_SLACK_WEBHOOK_URL si dégradé

[cron */30 min] ai-capacity-check (patch-22)
  └─ usage tokens/jour cumulé du pool de providers (Redis) → Slack ops aux paliers
     80/90% + providers épuisés ; pacé max 1 ping / 2h (anti-spam)

[cron quotidien 6h UTC] schedule-tech-stack (patch-18)
  └─ INDÉPENDANT du scrape-monitor homepage. Enqueue les competitors dûs
     (tech_stack_scraped_at null || < now - TECH_STACK_SCRAPE_INTERVAL_DAYS,
      url non-null, non supprimés, type != self) → scrape-tech-stack

[par competitor dû] scrape-tech-stack (patch-18 ; trigger aussi dev-only via
  POST /api/dev/competitors/:id/scrape-tech-stack — Run manuel depuis le tab
  Tech stack de la fiche competitor, monté seulement si NODE_ENV != production)
  └─ fetch() natif (pas la cascade scrape-page) → headers + HTML + scriptUrls
       (cheerio) ; null/blocked → skip le diff (sinon false-disappear)
  └─ detectTechStack (catalogue local, 4 familles : scripts/headers/dom/footer) +
       merge page /integrations si présente (absence silencieuse)
  └─ diff vs tech_stack_entries actives : appeared / disappeared → upsert PG
       (réactivation en place) + CH tech_stack_history (appeared/disappeared) +
       competitors.tech_stack_scraped_at = now
  └─ apparition d'importance >= TECH_STACK_SIGNAL_MIN_IMPORTANCE → monitor ancrage
       tech_stack (isActive=false, lazy) + snapshot R2 + 1 change/tech →
       generate-signal (Classification synthétique category=product, severity selon
       importance) → feed signals normal. Disparition ne génère jamais de signal.
```

> **Observabilité ops (patch-02)** : chaque scrape (`scrape_runs`) et chaque appel IA
> (`ai_runs`) est loggé best-effort en ClickHouse par les **jobs** (la tâche `@outrival/ai`
> reste pure). Le logging ne casse jamais le scrape/l'IA (try/catch silencieux). Le
> dashboard interne `/admin` (Next route group `(admin)`) est gaté par l'allowlist
> `ADMIN_EMAILS` (≠ role owner) : santé scraping/IA, coût (estimations), feedbacks,
> debug user + force scrape, audit log (`audit_log` Postgres). Routes `/api/admin/*` :
> `authMiddleware` PUIS `adminMiddleware`. Les jobs d'extraction/résumé
> (`extract_pricing`/`extract_jobs`/`extract_reviews`/`extract_self_profile`/
> `source_summary`/`competitor_summary`) loggent aussi `ai_runs` via le wrapper
> `loggedAi` — avant ils ne loggaient rien, donc un rate-limit Groq y était silencieux.
>
> **Banner IA dégradée (user-facing)** : `GET /api/system/ai-status` (auth, tous users)
> lit les `ai_runs` status=`error` des 15 dernières min via `clickhouse-safe` (≥2 →
> dégradé, sinon best-effort `{degraded:false}` si CH down). Le `<AiStatusBanner>` du
> dashboard layout poll cet endpoint (60s) et affiche « AI insights are delayed » quand
> dégradé ; dismiss persiste l'`incident key` (`since`) en localStorage → un nouvel
> échec ré-affiche. Le rate-limit étant sur la clé provider partagée, le banner vaut
> pour tout le workspace.

## Authentification (patch-19)

Page **unique `/auth`** (groupe `(auth)`, layout qui redirige déjà si session). Plus
de `/login` ni `/register` séparés → redirects 308 (`next.config.ts`). Trois méthodes,
toutes via Better Auth :

- **Magic link (primaire)** : la page POST `/api/auth/check-and-send-magic-link`
  (router custom monté **avant** le wildcard `/api/auth/*`, sinon avalé). Le endpoint
  vérifie Turnstile + rate-limit + email (zod strict + anti-disposable) puis appelle
  `auth.api.signInMagicLink` (le compte est créé au **verify** s'il n'existe pas —
  `disableSignUp` défaut false). **Anti-enumeration ABSOLUE** : réponse HTTP identique
  que l'email existe ou non (les seuls 400 portent sur la requête : captcha/email
  invalide, jamais sur l'existence). Email envoyé via Resend (`auth@outrival.io`, HTML
  inline dark+amber), lien expirant en 10 min. Callback → `WEB_URL/dashboard`.
- **Google OAuth (secondaire)** : `authClient.signIn.social({ provider:"google" })`.
  Callback dérivé de `BETTER_AUTH_URL` → `/api/auth/callback/google`.
- **Email + password (fallback)** : replié sous « Prefer a password? ». Login only
  (les nouveaux comptes ne settent jamais de password via cette UI). `minPasswordLength`
  12 (appliqué seulement au **set**, pas au sign-in → rétrocompat des anciens comptes).

Sécurité transverse : Turnstile managed invisible (`lib/turnstile.ts`, bypass dev si pas
de secret) ; rate-limit Upstash par **email ET IP** (`middleware/auth-rate-limit.ts`,
no-op si Upstash absent, 429 identique email/IP) ; check HaveIBeenPwned k-anonymity
(`@outrival/shared` `validatePasswordWithHibp`, fail-open, building block pour un futur
set-password depuis settings). Events PostHog funnel (`auth_magic_link_requested/sent`,
`auth_google_clicked`, `auth_password_option_clicked`) gatés par le consentement (le
helper `track` no-op si pas opt-in). `emailSchema`/`passwordSchema` partagés
client/serveur (`packages/shared/src/validation/`).

> **Setup manuel (hors code)** : créer les credentials Google OAuth (Console Google,
> redirect URI = `{BETTER_AUTH_URL}/api/auth/callback/google` en dev **et** prod), le
> site Turnstile (CF dashboard, mode Managed), et vérifier le domaine `auth@outrival.io`
> dans Resend. Sans ces clés, le code dégrade proprement (Turnstile bypass, magic link
> no-op, rate-limit no-op).

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
GOOGLE_CLIENT_ID=            # patch-19 — Google OAuth (callback = BETTER_AUTH_URL/api/auth/callback/google)
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=  # patch-19 — Cloudflare Turnstile (managed, invisible). Empty → backend bypass (dev)
TURNSTILE_SECRET_KEY=
AUTH_RATE_LIMIT_EMAIL=3      # patch-19 — max attempts per email per window (Upstash; empty creds → no-op)
AUTH_RATE_LIMIT_IP=10        # patch-19 — max attempts per IP per window
AUTH_RATE_LIMIT_WINDOW_MIN=15 # patch-19 — window length in minutes
RESEND_AUTH_FROM=            # patch-19 — optional, defaults to "Outrival <auth@outrival.io>"

# Jobs
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_ID=

# Scraping & discovery (patch-20 — ScrapingBee/Webshare supprimés)
PROXYSCRAPE_DC_ENDPOINT=     # datacenter host:port (L2) — optionnel
PROXYSCRAPE_DC_USERNAME=
PROXYSCRAPE_DC_PASSWORD=
PROXYSCRAPE_RESI_ENDPOINT=   # residential host:port (L3/L4) — optionnel, PAS l'Unlimited enterprise
PROXYSCRAPE_RESI_USERNAME=
PROXYSCRAPE_RESI_PASSWORD=
CAMOUFOX_HEADLESS=true       # L4 dernier recours
CAMOUFOX_TIMEOUT_MS=60000
SCRAPING_LEVEL_1_ENABLED=true  # kill-switch L2 (datacenter)
SCRAPING_LEVEL_2_ENABLED=true  # kill-switch L3 (residential)
SCRAPING_LEVEL_3_ENABLED=true  # kill-switch L4 (camoufox)
EXA_API_KEY=
HOMEPAGE_SCROLL_PASSES=2              # patch-16 — progressive scroll passes (homepage only)
HOMEPAGE_LAZY_WAIT_MS=2000            # patch-16 — wait after each scroll pass
HOMEPAGE_NARRATIVE_MIN_SEVERITY=medium  # patch-16 — min severity to spend an AI narrative
ENRICHMENTS_PHASH_THRESHOLD=15          # patch-17 — Hamming distance → visual redesign
ENRICHMENTS_VOLATILE_THRESHOLD=5        # patch-17 — consecutive diffs → line is volatile
ENRICHMENTS_VOLATILE_RESET=10           # patch-17 — stable scrapes → analysable again
ENRICHMENTS_ANTIVOID_THRESHOLD=0.3      # patch-17 — content/median ratio → anti-void
ENRICHMENTS_RELEVANCE_MIN_SCORE=0.5     # patch-17 — min relevance score to emit a signal
TECH_STACK_SCRAPE_INTERVAL_DAYS=30      # patch-18 — days between tech-stack scrapes per competitor
TECH_STACK_SIGNAL_MIN_IMPORTANCE=medium # patch-18 — min tech importance to emit a signal on appearance

# AI
ANTHROPIC_API_KEY=           # provider abstrait — Claude fallback (provider="claude")
GROQ_API_KEY=                # back-compat : synthétise un provider Groq si aucun AI_PROVIDER_N

# AI provider pool (patch-22) — pool de PROVIDERS légaux OpenAI-compatibles, essayés
# free d'abord puis payant. AI_PROVIDER_1..N contigus (stop au 1er trou). priority =
# ordre d'essai. dailyTokenQuota = tokens/jour (pool skip à 95%). Vide → fallback GROQ_API_KEY.
# NE PAS utiliser plusieurs comptes Groq (viole les ToS) — des PROVIDERS distincts.
AI_PROVIDER_1_ID=cerebras          # free 1M tok/j, prio 1
AI_PROVIDER_1_BASE_URL=https://api.cerebras.ai/v1
AI_PROVIDER_1_API_KEY=
AI_PROVIDER_1_MODEL=llama-3.3-70b
AI_PROVIDER_1_TIER=free
AI_PROVIDER_1_DAILY_TOKEN_QUOTA=1000000
AI_PROVIDER_1_PRIORITY=1
AI_PROVIDER_2_ID=groq              # 1 compte, prio 2
AI_PROVIDER_3_ID=hyperbolic        # payant ~$0.40/M, fallback prio 3
# (… _BASE_URL/_API_KEY/_MODEL/_TIER/_DAILY_TOKEN_QUOTA/_PRIORITY par provider, cf .env.example)
AI_CIRCUIT_BREAKER_THRESHOLD=5     # échecs consécutifs (tous providers) avant coupure globale
AI_CIRCUIT_BREAKER_RESET_MIN=10    # minutes avant retry (breaker provider ET global)
AI_INTENSIVE_RATE_LIMIT=10         # actions IA-intensives par user par fenêtre (rate limit dur)
AI_INTENSIVE_WINDOW_SEC=3600       # fenêtre 1h

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

- **Pool de providers IA légaux (patch-22)** — remplace le pool multi-comptes Groq
  (qui violait les ToS Groq). `complete(config, options)` reste l'entrée unique de tous
  les prompts ; pour `provider="groq"` elle route via `callLLM` vers un **pool de providers
  OpenAI-compatibles** (Cerebras free prio1, Groq prio2, Hyperbolic payant prio3), essayés
  free→payant. Sélection par `pickProvider` (skip épuisés/breaker, round-robin même priorité),
  tracking quota **tokens/jour** + circuit breaker **par provider ET global**, tout en Redis
  (Upstash) → partagé entre runs workers isolés ; failover EN-APPEL borné sur 429/5xx (les
  callers synchrones restent résilients sans dépendre d'un retry Trigger). Sans Upstash/clés :
  dégrade en « 1er provider, pas de tracking ». Le 8b (`classificationFast`) collapse dans le
  model 70b de chaque provider. Claude reste le fallback `provider="claude"` (swap = 1 ligne
  `config.ts`). `ai_runs.provider` = le vrai provider du pool (via AsyncLocalStorage).
  Graceful degradation : breaker ouvert → banner `ai-status` (down + ETA), scrapes continuent,
  digest reporté ~1h. Rate limiting INTELLIGENT (staleness : skip si rien n'a changé, friction
  non bloquante) + rate limit DUR anti-abus (10 actions IA/h/user). Job `ai-capacity-check`
  (cron */30) alerte ops Slack aux paliers 80/90% (pacé 1 ping/2h).
- **Cascade scraping découplée (patch-20)** : fingerprint navigateur (Patchright/
  Camoufox) et réputation IP (datacenter/residential) escaladés séparément, du gratuit
  (L0 fetch, L1 Patchright sans proxy) au payant (L2 datacenter, L3 residential, L4
  Camoufox). Escalade routée par type d'échec. Apprentissage `monitor.requiresLevel`
  pour démarrer la cascade au bon niveau ; re-probe 14j pour redescendre. Pas de coût
  par requête (ScrapingBee/Webshare supprimés).
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
