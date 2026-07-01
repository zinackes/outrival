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
| Product               | SKU de l'org (patch-28) — wrapper fin sur un self-competitor (`selfCompetitorId`, ancre de monitoring) ; multi-SKU = N self-competitors. isPrimary/status/position |
| ProductCompetitor     | Junction product↔competitor (patch-28) — competitors au niveau Org, partagés (isSpecific=false) ou spécifiques ; pilote le tagging signals + les feeds par product |

## Stack

| Couche            | Technologie                              | Raison |
|-------------------|------------------------------------------|--------|
| Frontend          | **Next.js 16** App Router + React 19     | RSC + streaming, server components natifs |
| UI                | Tailwind v4 + shadcn/ui new-york         | Itération rapide, composants cohérents |
| API               | Hono sur Bun                             | 3-4× plus rapide que NestJS pour CRUD + triggers |
| Auth              | Better Auth v1.6                         | Self-hosted, flexible, bon DX |
| ORM               | Drizzle ORM                              | Type-safe, léger, Postgres |
| DB                | PostgreSQL (Neon)                        | Serverless, scale-to-zero, branching ; relationnel + time-series/analytics dans une seule base |
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

Neon (EU) — €0 free tier → ~$19/mois (Launch) à l'échelle
└── PostgreSQL — relationnel + time-series/analytics (ex-ClickHouse) dans une
    seule base. Connexion via le pooler (`-pooler`, ?sslmode=require).

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
user (+ two_factor_enabled), session, account, verification,
two_factor (secret, backup_codes, user_id, verified — plugin TOTP, settings P0),
passkey (public_key, credential_id, counter, device_type, backed_up, transports,
         aaguid, user_id — @better-auth/passkey WebAuthn, migration 0008)
```

### Domaine
```sql
organizations          id, name, slug, plan, stripe_customer_id, stripe_subscription_id,
                       plan_period, slack_webhook_url, digest_email, digest_enabled,
                       alerts_enabled, product_url, product_profile (jsonb),
                       onboarding_completed, created_at, updated_at

competitors            id, org_id, name, url, description, overlap_score, category,
                       metadata (jsonb), color (patch-33 — user-assigned identity:
                       palette token COMPETITOR_COLORS or "#rrggbb" hex; null =
                       neutral. UI stores hue+chroma, derives dark/light lightness
                       in CSS), ai_summary, ai_summary_updated_at,
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
                       seniority, posted_at, salary_min, salary_max,
                       salary_currency (patch-32 — cross-ATS hiring enrichment,
                       populated on the structured ATS API path, null on the
                       LLM/careers fallback), detected_at, closed_at, is_active

reviews                id, competitor_id, source (g2|capterra|appstore|playstore),
                       score, content, author (praise|complaint|<name>),
                       detected_at

battle_cards           id, competitor_id, org_id, content (jsonb — 6 sections
                       editables), pdf_r2_key, flagged_for_regeneration_at (patch-21),
                       based_on_user_update_at, based_on_competitor_signal_at (patch-22 —
                       staleness : inputs au moment de générer), product_id (patch-28),
                       generated_at, updated_at
                       — patch-28 : unique (product_id, competitor_id) ; une carte
                       par couple product↔competitor (plus competitor_id seul)

products               id, org_id, name, self_competitor_id (unique — l'ancre de
                       monitoring type=self ; url/profil/pricing/monitors y vivent),
                       is_primary, status (active|paused|archived), position,
                       created_at, updated_at  — patch-28, multi-SKU (wrapper fin)
product_competitors    product_id, competitor_id (PK composite), is_specific,
                       relevance_score, created_at  — patch-28, junction org-level

competitor_candidates  id, org_id, url, title, overlap_score, reason,
                       status (new|dismissed|added),
                       source (detection|onboarding), first_seen_at

discovery_runs         id, org_id, last_discovery_at, based_on_profile_update_at
                       — patch-22, staleness discovery on-demand (1 ligne/org, upsert sur /detect)

onboarding_sessions    id, user_id, org_id, stage (onboarding_session_stage),
                       mode (quick_start|full), product_url, product_profile (jsonb),
                       discovery_suggestions (jsonb), added_competitor_ids (jsonb),
                       timings (jsonb — milestone→epoch ms), started_at, last_activity_at,
                       completed_at — patch-25, resumable attempt + funnel metrics
                       (1 active/user, TTL ONBOARDING_RESUME_TTL_DAYS)

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

org_notification_preferences  id, org_id (unique), channel_critical/high/medium/low
                       (channel_mode), timezone, timezone_detected_at (null = override
                       manuel), quiet_hours_start/end, weekend_off, daily_email_cap,
                       batching_enabled — patch-26, modération notif ORG-scoped (1/org)
org_relevance_threshold       id, org_id (unique), threshold (real, def 0.5), source
                       (default|auto_adjusted|user_set), feedback_count_at_calc,
                       last_recalculated_at — patch-26, seuil pertinence auto-ajusté
signal_batches         id, org_id, competitor_id, signal_ids (jsonb), category, count,
                       summary (IA), highest_severity, window_start/end — patch-26, layer 5

signals                + relevance_score (patch-17 persisté patch-26), dispatched_channel,
                       filtered_reason, filtered_at (décision du dispatcher),
                       batched_into_id (→ signal_batches), daily_digest_sent_at — patch-26,
                       + product_ids (jsonb — patch-28, products affectés, taggés
                       déterministe via product_competitors ; feed filtre `@> [id]`)
changes                + relevance_score (real, nullable — max des changes significatifs,
                       structured homepage only) — patch-26
forced_rescan_log      id, user_id, org_id, monitor_id, task_id, triggered_at,
                       result_captured_at, had_new_signal — patch-27, audit/analytics des
                       re-scans forcés user. Limite/jour/tier comptée ici (par user) ;
                       had_new_signal stampé par le worker (change trouvé ou non).
                       Alimenté par TOUT re-scrape manuel (helpers communs
                       lib/plan.ts) : /monitors/:id/force-rescan, /monitors/:id/run
                       (re-scans seulement — le 1er scrape d'une source juste
                       activée est exempté) et /my-product/rescan
parser_extractors      id, domain (host www-stripped), source_type, spec (jsonb —
                       ExtractorSpec : sélecteurs CSS + transforms whitelistés),
                       version, heal_count, consecutive_failures, last_validated_at,
                       last_heal_attempt_at — patch-30, cache parser déterministe par
                       (domain, source_type), clé réutilisable cross-org. 📄 docs/staged-extraction.md

competitors            + platform_profile (jsonb — patch-31, PlatformProfile :
                       framework/cms/ats/pricingWidget/statusPage/changelog/analytics[]
                       + confidence/evidence) + platform_detected_at (cadence re-détection).
                       AI-free, route une source → son connecteur structuré. 📄 docs/platform-detection.md

ask_history            id, org_id, user_id, question, answer, citations (jsonb),
                       context (jsonb : { label, competitorId? } — page d'où la question
                       a été posée, nullable), created_at — historique Ask Outrival
                       mono-tour, 1 ligne/échange, scopé (org, user), écrit best-effort.
                       Multi-tour (ask_conversations parent) différé. 📄 docs/ask-outrival.md
```

### Enums Postgres
```
plan              free | starter | pro | business
billing_period    monthly | yearly
source_type       homepage | pricing | blog | changelog | jobs |
                  g2_reviews | capterra_reviews | appstore_reviews |
                  trustpilot_reviews | trustradius_reviews | gartner_reviews |
                  playstore_reviews | reddit | linkedin | twitter | github_repo |
                  tech_stack | status | sitemap | news
                  — reviews+ (trustpilot/trustradius/gartner/playstore) : patch-32, enable
                    on-demand pro+, même chemin que g2/capterra. reddit : patch-32,
                    mention-tracking (pas de page notée → pas de ligne review_scores).
                  — internes, jamais user-selectable : tech_stack (patch-18, infra, tab
                    read-only), sitemap + news (patch-32, semés weekly, diff = pages/
                    événements neufs). status : on-demand starter+ (patch-31).
                    Comportement détaillé : cf. Pipeline + Décisions.
frequency         realtime | daily | weekly
signal_severity   low | medium | high | critical
signal_category   pricing | product | hiring | reviews | content | funding
notification_type signal | new_competitor | self_change | onboarding_complete |
                  structural_change | silent_monitor
                  (silent_monitor = patch-27, source sans signal depuis 60j+ ;
                   1/org/30j via le dispatcher patch-26)
candidate_status  new | added | dismissed
candidate_source  detection | onboarding
battle_card_status pending | generating | ready | failed
onboarding_session_stage  started | input | profile | discover | monitoring |
                  analysis_in_progress | completed | abandoned   (patch-25)
channel_mode      email_immediate | digest_daily | digest_weekly | in_app_only | muted
                  (patch-26 — canal de notif par severity)
product_status    active | paused | archived   (patch-28 — SKU ; archivage soft)
```

## Schéma analytics / time-series (Postgres, append-only — ex-ClickHouse)

> Migré de ClickHouse vers Postgres : ces tables vivent dans la **même base Neon**
> que le relationnel (`packages/db/src/schema/analytics.ts`). Append-only, sans FK
> (best-effort logging), index sur `(competitor_id, recorded_at)` / `(recorded_at)`.

```sql
pricing_history     competitor_id, plan_name, price, currency, billing_period,
                    has_trial, trial_days, trial_requires_card (patch-33 — free-trial
                    facts, AI-free regex on the page text, stamped page-level per row,
                    Nullable = pre-detection), recorded_at
job_counts          competitor_id, department, count, recorded_at
review_scores       competitor_id, source, score, review_count, sentiment_score,
                    sub_ease_of_use, sub_support, sub_features, sub_value (Nullable —
                    patch-32 sous-notes /5), recorded_at
signal_feed         org_id, competitor_id, category, severity, recorded_at
scrape_runs         monitor_id, competitor_id, source_type, status (success|no_change|
                    failed), level (0-4 cascade — patch-20), attempts, failure_reason,
                    duration_ms, recorded_at  — ops (patch-02/20)
ai_runs             task (classify|classify_structured|narrate_change|insight|digest|
                    battle_card|extract_pricing|extract_jobs|extract_reviews|
                    extract_self_profile|generate_extractor|source_summary|
                    competitor_summary|batch_summary|ask|…), provider, model,
                    status (success|parse_failed|error), recorded_at      — ops (patch-02 ;
                    `ask` = Ask Outrival, 1er logger ai_runs côté API via lib/ai-runs.ts)
extraction_runs     competitor_id, source_type, domain, resolution (structured|cache|
                    heal|ai_fallback), extractor_version, ai_used (0/1), recorded_at
                    — patch-30, % de scrapes résolus par étage = arbitre du coût IA
numeric_claims      competitor_id, monitor_id, pattern (user_count|uptime|scale|…),
                    unit, context, value, raw_text, observed_at          — patch-17
tech_stack_history  competitor_id, tech_id, event (appeared|disappeared),
                    importance, recorded_at                              — patch-18
platform_detection_runs  competitor_id, domain, stage (a_static|b_browser),
                    framework, cms, ats, pricing_widget, status_page, changelog,
                    techs_found, duration_ms, recorded_at — patch-31, % résolu step A
                    (sans navigateur) vs step B + connecteurs routés
```

**Pattern d'accès** :
- Inserts depuis workers via `apps/workers/src/lib/analytics.ts` (Drizzle, best-effort
  + logger — une erreur de logging ne casse jamais un scrape/job IA)
- Queries depuis API via `apps/api/src/lib/analytics-safe.ts` — `analyticsQuery(sql)`
  best-effort (`[]` en cas d'erreur). SQL Postgres standard (`count(*) filter`,
  `distinct on`, `make_interval`, window functions). Plus de race/timeout cold-start :
  c'est la même base que le relationnel
- Tables gérées par Drizzle (`pnpm db:push`) comme le reste du schéma — plus de `ch:setup`

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
  (`candidates.ts`) → sèment `homepage` (daily), `pricing` (daily), `blog` (weekly)
  + l'ancre interne `news` (weekly) ; la création manuelle sème en plus `sitemap`
  (weekly). Sources figées, non gated (toutes incluses dès le plan free) ; les ancres
  internes (`sitemap`/`news`) ne sont jamais user-selectable.
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
         (claims → Postgres numeric_claims), customer_logo_+/- , testimonial_+/- (stable 6
         scrapes, carousel-safe) ; apprentissage volatile (volatile_lines) filtre la churn ;
         SCORE DE PERTINENCE filtre < 0.5 (silence) ; si [] / tout silencé → aucun change/signal ;
         sinon insert change (diff_type="structured") → classify-change
       sinon / homepage sans structure précédente (pre-patch) → diff lexical (fallback)
       si change : trigger classify-change
  └─ routing par sourceType (extraction étagée patch-30 — l'IA passe du chemin chaud au
       chemin froid : structured-first JSON-LD → cache parser déterministe (parser_extractors)
       → self-heal IA (régénère le parser, rare) → extraction IA directe = PLANCHER ; chaque
       étage logué dans extraction_runs ; STAGED_EXTRACTION_ENABLED=false → plancher seul) :
       pricing → extract-pricing → Postgres pricing_history   (pipeline complet)
                  (patch-32 : gate plausible = ratio mensuel↔annuel ; un JSON-LD mé-parsé
                   retombe sur l'IA. URL pricing auto-découverte depuis la home nav/footer.
                   patch-33 : `detectTrial` AI-free sur le texte de la page → free-trial
                   (présence / durée / CB requise) stampé sur les rows pricing_history,
                   indépendant de l'étage d'extraction ; alimente le badge pricing tab +
                   le contexte battle-card)
       jobs    → extract-jobs    → diff actives + Postgres job_counts
                  (structured-first = ATS API JSON island puis JobPosting JSON-LD ; pipeline complet.
                   patch-32 : 7 ATS — Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee/Workable +
                   Personio (feed XML) ; schéma cross-ATS enrichi séniorité/datePost/salaire normalisé.
                   careers-link discovery élargie (labels « Jobs »/« Hiring », paths open-positions,
                   boards Notion off-site) + JOBS_RENDER_ENABLED : la page careers/board retenue et
                   les hops off-site sont rendus au navigateur (L1) + scroll, sinon les offres injectées
                   côté client — placeholder SSR « Loading positions… » — restent invisibles ; le
                   probing des paths reste en L0. Sans ça : chemin L0-only précédent)
       g2/capt → extract-reviews → praises/complaints + Postgres review_scores
                  (structured-first scores via AggregateRating ; résumé qualitatif reste IA.
                   patch-32 : l'extraction IA renvoie en plus les sous-notes /5
                   ease_of_use/support/features/value → CH review_scores (colonnes Nullable)
                   + des THÈMES de plaintes clusterisés (IA-juge, même appel) → résumé)
       changelog → diff générique (patch-32 : feed-first — si la page expose un RSS/Atom,
                   on parse le feed → snapshot déterministe trié → le diff détecte les
                   nouvelles entrées de release ; sinon change-detection HTML, comportement actuel)
       sitemap → diff générique (patch-32 : scraper résout robots.txt Sitemap:/paths
                   conventionnels, walk index + .gz, émet la liste d'URLs triée → le diff
                   surface les pages neuves/retirées ; catégorisation par path. Interne, weekly)
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
  └─ insert signal (idempotent par changeId) + copie change.relevance_score (patch-26)
  └─ insert Postgres signal_feed (best-effort)
  └─ MODÉRATION (patch-26) : decideDispatch(orgId, {severity, relevanceScore, …}) applique
       5 couches ORG-scoped dans l'ordre — (1) seuil pertinence (skip si pas de score) ,
       (2) canal par severity, (3) quiet hours, (4) frequency cap ; critical bypasse TOUT.
       Stamp signals.dispatched_channel/filtered_reason/filtered_at. email_immediate →
       trigger send-alert (gating plan inchangé) ; sinon déféré au digest (daily/weekly)

[par signal critique] send-alert
  └─ insert notification (in-app, si realtimeAlerts dans le plan)
  └─ Slack webhook (si plan + url configurée)
  └─ Email Resend (toujours, sauf erreur)
  └─ insert alerts row (avec error si échec)

[cron lundi 8h UTC] generate-weekly-digest
  └─ idempotent par (orgId, weekStart)
  └─ skip orgs sans signal de la semaine
  └─ Groq insight global → HTML inline → Resend

[cron horaire] generate-daily-digest (patch-26)
  └─ canal digest_daily (high par défaut + signals déférés par quiet hours / freq cap)
  └─ fire par org quand l'heure LOCALE = quiet_hours_end (matin) → 1 digest/jour local
  └─ idempotent via signals.daily_digest_sent_at

[cron */6h] signal-batching (patch-26)
  └─ layer 5 : 3+ signals même competitor+category sur BATCHING_WINDOW_HOURS → 1 batch +
     summary IA (best-effort), stamp signals.batched_into_id ; critical jamais batché ;
     orgs opt-out via batching_enabled

[cron dimanche 3h UTC] relevance-threshold-recalculation (patch-26)
  └─ par org : quality_feedback (signal) ⋈ signals.relevance_score → seuil = milieu
     avg(useful)/avg(not_useful), clamp 0.2-0.8 ; ≥10 feedbacks & ≥3 de chaque côté

[cron quotidien 8h UTC] detect-silent-monitors (patch-27)
  └─ monitors actifs, !markedUnscrapable, !self, !tech_stack — dernier signal
     (signals ⋈ changes) ou createdAt < now - SILENT_MONITOR_ALERT_THRESHOLD_DAYS
  └─ 1 ping Slack ops (liste) + notif user "silent_monitor" 1/org/30j via dispatcher
     patch-26 (in-app toujours ; email best-effort si canal medium = email_immediate)

[on-demand] force-rescan (patch-27, POST /api/monitors/:id/force-rescan)
  └─ user-forced : limite/jour par tier (env, comptée par user dans forced_rescan_log),
     trigger scrape-monitor {force:true} (réutilise le bypass dedup existant) ; le worker
     stampe forced_rescan_log.had_new_signal ; le web poll le statut → toast contextuel

[cron dimanche 20h UTC] detect-new-competitors
  └─ par org onboardée : Exa findSimilar + scoreOverlap (batché)
  └─ dedup URL exacte + hostname normalisé
  └─ si overlap > 65 → insert candidate + notification "new_competitor"

[on-demand] generate-battle-card
  └─ gather context (productProfile, aiSummary, top reviews, recent signals)
  └─ Groq battle card 6 sections → upsert content
  └─ Playwright headless → page.pdf({format:"A4"}) → R2

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
> (`ai_runs`) est loggé best-effort en Postgres par les **jobs** (la tâche `@outrival/ai`
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
> lit les `ai_runs` status=`error` des 15 dernières min via `analytics-safe` (≥2 →
> dégradé, sinon best-effort `{degraded:false}` si CH down). Le `<AiStatusBanner>` du
> dashboard layout poll cet endpoint (60s) et affiche « AI insights are delayed » quand
> dégradé ; dismiss persiste l'`incident key` (`since`) en localStorage → un nouvel
> échec ré-affiche. Le rate-limit étant sur la clé provider partagée, le banner vaut
> pour tout le workspace.

## Authentification (patch-19)

Page **unique `/auth`** (groupe `(auth)`, layout qui redirige déjà si session). Plus
de `/login` ni `/register` séparés → redirects 308 (`next.config.ts`). Trois méthodes,
toutes via Better Auth :

- **Code email + lien (primaire)** : entrée unique « Continue with email » (pas
  d'onglets login/signup). La page POST `/api/auth/check-and-send-magic-link` (router
  custom monté **avant** le wildcard `/api/auth/*`, sinon avalé). Le endpoint vérifie
  Turnstile + rate-limit + email (zod strict + anti-disposable) puis appelle
  `auth.api.sendVerificationOTP({ type:"sign-in" })` (plugin Better Auth **emailOTP**,
  remplace `magicLink`). UN seul email Resend (`auth@outrival.io`, HTML inline
  dark+amber) porte **les deux** : un code 6 chiffres (saisi dans 6 cases sur `/auth`,
  marche cross-device) **et** un bouton « Sign in » → `GET /api/auth/otp-link?email&code`
  (vérifie le code server-side, pose le cookie, 302 `/dashboard` ; échec → 302
  `/auth?error=link_invalid`). Le code/lien (TTL 10 min, single-use, `allowedAttempts:3`)
  fait **login OU signup** indifféremment — le compte est créé au verify s'il n'existe
  pas (`disableSignUp` défaut false), l'utilisateur ne sait jamais lequel a eu lieu.
  La saisie du code vérifie via `POST /api/auth/sign-in/email-otp` (fetch direct,
  `credentials:"include"`). **Anti-enumeration ABSOLUE** : réponse HTTP identique que
  l'email existe ou non (les seuls 400 portent sur la requête : captcha/email invalide,
  jamais sur l'existence).
- **Google OAuth (secondaire)** : `authClient.signIn.social({ provider:"google" })`.
  Callback dérivé de `BETTER_AUTH_URL` → `/api/auth/callback/google`.
- **Email + password (fallback)** : replié sous « Prefer a password? ». Login only
  (les nouveaux comptes ne settent jamais de password via cette UI). `minPasswordLength`
  12 (appliqué seulement au **set**, pas au sign-in → rétrocompat des anciens comptes).

### 2FA (TOTP) + changement d'email — settings security P0

- **Two-factor (authenticator app)** : plugin Better Auth `twoFactor`
  (`allowPasswordless`, issuer "Outrival"). Le plugin n'intercepte nativement que
  `/sign-in/email` + `/sign-in/username` — un hook `hooks.after` dans `lib/auth.ts`
  **étend** sa sign-in partielle aux chemins **email-OTP** et **callback OAuth
  (Google)** : pour un user `twoFactorEnabled`, la session fraîche est détruite et
  remplacée par le cookie de challenge `two_factor` que `/two-factor/verify-totp`
  consomme. **Safe-by-default** : le hook early-return si 2FA non activé → zéro
  impact tant que personne n'opte. Activation **verify-first** (le flag ne passe à
  true qu'après confirmation d'un code → pas de lockout) ; **backup codes** au
  setup, utilisables une fois au sign-in (`/two-factor/verify-backup-code`).
  UI : `settings/security` (enable → QR + clé + backup codes → confirm ; disable),
  étape TOTP sur `/auth` (inline pour email-OTP, `?twofactor=1` pour lien/Google).
  Migration `0007` (`user.two_factor_enabled` + table `two_factor`).
- **Changement d'email self-serve** : `emailOTP({ changeEmail })`. Un code part vers
  le **nouvel** email (`type "change-email"`, anti-enumeration : silence si déjà
  pris), l'email ne bascule qu'après confirmation. UI 2 étapes dans `settings/profile`.
- **Export RGPD + suppression de compte + déconnexion OAuth (P1)** :
  `GET /api/settings/export` assemble côté serveur, **org-scoped**, toute la donnée
  relationnelle (competitors/monitors/signals/digests/products/candidates/battle
  cards/jobs/reviews ; hors snapshots R2 + analytics). `DELETE /api/settings/account`
  = `eraseOrg(detachUsers:false)` (cascade le `users` app) **puis** delete du `user`
  Better Auth (cascade session/account/two_factor) → distinct de "delete workspace"
  (qui garde le login). `POST /api/auth/disconnect-oauth` délie un provider (Google)
  en supprimant la ligne `account` directement — l'`unlink-account` natif exige une
  session < `freshAge` (24h), inutilisable avec nos sessions 30j ; pas de lockout
  car le login email-OTP ne dépend d'aucune ligne `account`.
- **Auth/login P0+P1 (audit connexion)** : toggle show-password sur le fallback
  password · récup mot de passe oublié = lien « sign in with an email code instead »
  (modèle OTP-first, pas de reset-token) · `rateLimit.customRules` Better Auth sur
  `/sign-in/email`, `/sign-in/email-otp` et les verify 2FA (par IP, single-instance) ·
  2FA « trust this device » (checkbox → `trustDevice` ; le hook custom honore le cookie
  trust-device signé sur les chemins email-OTP/Google, pas que password).
- **Passkeys / WebAuthn** : plugin `@better-auth/passkey` (package séparé → bump
  `better-auth` 1.6.11→1.6.22 prérequis). Table `passkey` (migration `0008`), rpID/origin
  dérivés de **WEB_URL** (origine page, pas l'API). UI gated `NEXT_PUBLIC_PASSKEYS_ENABLED`
  (dark par défaut) : « Add a passkey » (Settings → Security, list/add via
  `authClient.passkey.*`, delete via route) + « Sign in with a passkey » sur `/auth`
  (`signIn.passkey()`). Safe-by-default ; **à valider sur staging avec un device réel**
  avant d'activer le flag. **Différé** : idle-timeout
  (longueur de session = décision produit, 30j OK pour la veille), email « nouvel
  appareil » (besoin d'un signal login-complété fiable + persistance device — à bâtir
  avec le journal d'activité), SSO Apple/Microsoft (enregistrement OAuth externe).
- **Settings P2 (polish)** : recherche dans la rail settings (label + keywords) ·
  **re-auth step-up** sur les actions destructives (delete workspace/account) —
  `POST /api/settings/reauth/send` émet un code 6 chiffres single-use, attempt-capped,
  stocké dans la table `verification` (`reauth-<userId>`), exigé en plus du
  type-to-confirm (une session volée seule ne peut plus effacer) · factures Stripe
  in-app (`GET /api/billing/invoices`, best-effort) · fenêtre de rétention du plan +
  liens privacy/terms dans Data. Différé : journal d'activité sécurité (nécessite la
  persistance des events de login ; les sessions actives montrent déjà l'heure de connexion).

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
DATABASE_URL=                # PostgreSQL Neon (pooled endpoint, ?sslmode=require)

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
# Onboarding (patch-25)
NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY=true   # prefetch discovery during profile edit
NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS=3000 # debounce before prefetch (limits Exa spend)
ONBOARDING_RESUME_TTL_DAYS=7                      # days an unfinished session stays resumable
HOMEPAGE_SCROLL_PASSES=2              # patch-16 — progressive scroll passes (homepage only)
HOMEPAGE_LAZY_WAIT_MS=2000            # patch-16 — wait after each scroll pass
HOMEPAGE_NARRATIVE_MIN_SEVERITY=medium  # patch-16 — min severity to spend an AI narrative
HOMEPAGE_SCREENSHOT_ENABLED=true     # capture a homepage screenshot (floors the cascade at L1 = browser render per homepage scrape) → pHash visual-redesign + before/after visual diff. false = cheap L0 fetch, no screenshot
JOBS_RENDER_ENABLED=true             # jobs source only — render the committed careers/board page at L1 + scroll so client-injected openings (SSR "Loading positions…" placeholders) load before extraction. Path probing stays cheap L0; only the kept page + off-site hops pay a render. false = previous L0-only behaviour exactly
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
AI_PROVIDER_1_MODEL=gpt-oss-120b   # NOT llama-3.3-70b (404 model_not_found on Cerebras free tier)
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

# Notification moderation (patch-26)
NOTIFICATION_DAILY_EMAIL_CAP=10        # max emails immédiats/jour/org (critical bypasse)
NOTIFICATION_CRITICAL_BYPASS=true      # critical ignore tous les filtres
QUIET_HOURS_DEFAULT_START=22           # quiet hours début, 0-23 heure locale org
QUIET_HOURS_DEFAULT_END=8              # quiet hours fin (aussi heure d'envoi du daily digest)
QUIET_HOURS_WEEKEND_OFF=true           # samedi+dimanche muets par défaut
RELEVANCE_THRESHOLD_DEFAULT=0.5        # seuil pertinence par défaut (0-1)
RELEVANCE_AUTO_ADJUST_MIN_FEEDBACKS=10 # min feedbacks org avant auto-ajustement
RELEVANCE_RECALC_INTERVAL_HOURS=168    # cadence recalc (hebdo)
BATCHING_WINDOW_HOURS=24               # fenêtre de regroupement
BATCHING_MIN_SIGNALS=3                 # min signals similaires pour un batch

# Stale-data actions (patch-27)
STALENESS_THRESHOLDS_PRICING=7,14,30   # seuils jaune,orange,rouge par type de source (jours)
STALENESS_THRESHOLDS_FEATURES=14,30,60 # (github_repo → features)
STALENESS_THRESHOLDS_REVIEWS=21,45,90
STALENESS_THRESHOLDS_JOBS=14,30,60
STALENESS_THRESHOLDS_BLOG=30,60,120
STALENESS_THRESHOLDS_HOMEPAGE=14,30,60
FORCED_RESCAN_LIMIT_FREE=1             # override des défauts PLAN_LIMITS (re-scans forcés/jour/user)
FORCED_RESCAN_LIMIT_STARTER=5
FORCED_RESCAN_LIMIT_PRO=20
FORCED_RESCAN_LIMIT_BUSINESS=100       # tier-limits 2026-06-04 : vrai cap, plus « illimité »
SILENT_MONITOR_ALERT_THRESHOLD_DAYS=60 # alerte ops + user si source sans signal depuis Nj

# Self-product multi-SKU (patch-28)
PRODUCT_LIMIT_FREE=1                    # max products (SKUs) actifs par org / tier
PRODUCT_LIMIT_STARTER=2
PRODUCT_LIMIT_PRO=5
PRODUCT_LIMIT_BUSINESS=999

# Staged extraction pipeline (patch-30)
STAGED_EXTRACTION_ENABLED=true         # false → bypass des étages, comportement actuel exact (plancher)
EXTRACTOR_HEAL_COOLDOWN_HOURS=12       # min heures entre 2 self-heal sur un extracteur cassé (anti-thrash)
PRUNE_HTML_MAX_CHARS=40000             # cap de l'HTML élagué envoyé au générateur de sélecteurs

# Platform auto-detection (patch-31)
PLATFORM_DETECTION_ENABLED=true        # false → pas de profil écrit, routage = comportement actuel exact
PLATFORM_REDETECT_INTERVAL_DAYS=30     # cadence re-détection périodique par competitor
PLATFORM_DNS_ENABLED=true              # résolution CNAME (signal 6, node:dns) ; false → skip
PLATFORM_STEP_B_ENABLED=true           # autorise le fallback navigateur (api-capture) si step A maigre
PLATFORM_REDETECT_DRIFT_COOLDOWN_HOURS=24  # min heures entre re-détections sur drift connecteur (self-heal)

# Visual diff (Phase 8) — before/after homepage screenshots sur un signal (proxy
# R2 org-scopé, no-IA). 📄 docs/visual-diff.md
VISUAL_DIFF_ENABLED=true               # false → endpoints screenshot 404, section diff masquée

# AI Visibility / "Share of Model" — présence self + concurrents dans les réponses des
# moteurs IA (Perplexity d'abord). Feature premium (features.aiVisibility, pro+).
# 📄 docs/ai-visibility.md
AI_VISIBILITY_ENABLED=true             # false → scheduler + job no-op (kill-switch)
AI_VISIBILITY_INTERVAL_DAYS=7          # cadence par org (jours entre 2 runs)
AI_VISIBILITY_MAX_PROMPTS=10           # cap prompts/org/run (garde-fou coût)
PERPLEXITY_API_KEY=                    # moteur Perplexity Sonar ; vide → moteur skip (0 coût)
AI_VISIBILITY_PERPLEXITY_MODEL=sonar   # modèle Perplexity (sonar = search fee le moins cher)

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

- **Ask Outrival — intelligence conversationnelle (feature ad-hoc)** — NL → réponse
  anglaise groundée sur la donnée Postgres **déjà** trackée (pas de RAG, pas d'ingestion).
  **Agent à OUTILS** org-scopés (`lib/ask/tools.ts`, jamais de SQL LLM) en **boucle 2
  passes** : PLAN (résout nom→id via roster injecté) → exécution outils côté API (`orgId`
  de la session, **jamais** du modèle) → SYNTHÈSE (citations deep-linkées). Isolation tenant
  absolue : tout outil résout le competitor *dans* l'org → id forgé = vide. `POST /api/ask`
  (auth + rate-limit 10/h/user), SSE streaming, réutilise le pool providers (patch-22), 1er
  logger `ai_runs` côté API. Sans cache (la réponse doit refléter la donnée courante).
  **Historique** persisté (`ask_history`, par org+user, best-effort) → `GET /api/ask/history`
  + liste « Recent questions » dans le panel. **Contexte de page** : chaque page déclare
  son entité/vue (`useSetAskContext`) → envoyée en `context` structuré, injectée dans les
  prompts (remplace le préfixe « Regarding X: »). Mono-tour ; multi-tour différé.
  📄 docs/ask-outrival.md
- **Page Activity user-facing (feature ad-hoc)** — `/dashboard/activity` expose le travail
  de scraping de l'org (transparence, distinct du feed Signals). `routes/activity.ts` :
  `/health` (monitors ⋈ competitors → statut `ok|failing|paused|unscrapable`) + `/timeline`
  (`scrape_runs` org-scoped best-effort, incl. no-change/échecs). Échecs adoucis, sources
  internes exclues, tous tiers. 0 migration, 0 IA.
- **Couverture des sources élargie (patch-32)** — étend la couverture par source via la
  détection plateforme (patch-31) + le pipeline étagé (patch-30), sans toucher la cascade.
  **HIRING** : 7 connecteurs ATS no-auth (+ Personio feed XML) + schéma d'offre cross-ATS
  enrichi (séniorité/datePost/salaire normalisé via `normalizeSalary`) → 5 colonnes
  `job_postings` (null sur fallback LLM). **PRICING** : gate `plausible` ratio mensuel↔annuel
  (sinon retombe sur l'IA). **SIGNALS** : changelog **feed-first** (RSS/Atom → snapshot trié)
  + nouvelle source interne **sitemap** (diff = pages neuves/retirées). **REVIEWS** : sous-notes
  /5 (ease_of_use/support/features/value → review_scores Nullable) + thèmes de plaintes
  (IA-juge, même appel) ; **multi-plateforme** — 4 sources (trustpilot/trustradius/gartner/
  playstore, enable on-demand pro+, URL brand-locked) + **reddit** (mention-tracking, pas de
  score → skip review_scores). **HOMEPAGE** : `og:image`/`og:type` → `meta_changed` (rebrand).
  Parsers purs AI-free dans `scrapers` (`/feeds`, `/sitemap`, `/pricing`). 117 tests.
- **Pipeline d'extraction étagé (patch-30)** — l'IA quitte le chemin chaud (chaque scrape)
  pour le froid (création/réparation rare d'un extracteur). 4 étages cheap→cher, le dernier =
  comportement actuel (plancher, kill-switch `STAGED_EXTRACTION_ENABLED`) : (1) structured-first
  (JSON-LD/OpenGraph, 0 IA) → (2) cache parser déterministe `parser_extractors` (0 IA) →
  (3) self-heal IA (régénère le parser, SEUL nouvel appel IA, cooldown) → (4) extraction IA
  directe (plancher). Validation = schéma Zod source + plausibilité à chaque étage. Plein gain
  pricing+jobs ; reviews = scores structured, résumé reste génératif. Métrique `extraction_runs`
  (% par étage) = arbitre du coût IA (`/admin/scraping`). 📄 docs/staged-extraction.md
- **Détection auto de plateforme (patch-31)** — porte d'entrée du structured-first : détecte
  la stack **et extrait l'identifiant** (token ATS, host status-page, feed RSS), cache un
  `PlatformProfile` sur `competitors`, route chaque source vers son connecteur structuré.
  **Pur pattern-matching, 0 IA** : moteur compatible-Wappalyzer (matcher + dataset maison, le
  dataset GPL-3.0 NON vendorisé) + signatures métier ID-bearing + 6 signaux (headers/HTML/
  scripts/cookies/JS globals/CNAME). Cheap→cher : step A sans navigateur, step B (api-capture
  patch-23) si A maigre. Détection à l'ajout + 30j + self-heal sur drift connecteur. Routage :
  `jobs`→API ATS sans render, `status`=nouvelle source (starter+) ; changelog/pricing-widget
  différés. Kill-switch `PLATFORM_DETECTION_ENABLED`. 📄 docs/platform-detection.md
- **Limites par tier centralisées (2026-06-04)** — `PLAN_LIMITS` (`@outrival/shared`) =
  unique source de vérité de toute limite par tier (pas de table parallèle). Grille chiffrée
  (competitors business 50, forcedRescans 100, battleCardsPerDay, discoveriesPerMonth,
  usersPerOrg, historyRetentionDays, scrapeFrequency, features). Enforcement période via
  `assertWithinLimit` + `tierLimitBody` (429 structurée → upgrade contextuel) : battle cards/
  jour (4 tiers) + discoveries/mois (`discovery_runs`). Différé (gate TODO) : purge
  `historyRetentionDays`, `usersPerOrg`, `crmIntegrations`, fair-use. 📄 docs/tier-limits.md
- **Sub-sidebar contextuelle (patch-29)** — sur `/dashboard/settings/*` la sidebar settings
  **remplace** la rail principale (pattern Vercel/Stripe), swap `usePathname` `AppSidebar ↔
  SettingsSidebar` dans `DashboardShell`. Settings Personal/Workspace/Danger (Members gated
  `FEATURE_FLAGS.multiUser`). Rail rationalisée (Overview/Signals/Competitors/Products/
  Discovery) ; renames de route (`my-product→products`, `candidates→discovery`,
  `settings/workspace→settings/general`, 301). Alerts = tab du feed Signals ; battle cards
  hors rail (`GET /api/battle-cards` → page dédiée + "Recent" overview). Pur frontend/nav.
- **Multi-SKU non-destructif (patch-28)** — une org gère 1+ `products`. Plutôt que
  de remplacer le self-competitor (`competitors.type="self"`, tissé dans ~11 jobs +
  clés analytics + R2), un `product` est un **wrapper fin** qui le référence
  (`products.selfCompetitorId`, 1:1) : le self-competitor reste l'ancre de monitoring,
  donc le pipeline scrape/extraction/CH/R2 est **intouché**. Multi-product = N
  self-competitors. Concurrents au niveau Org, liés via `product_competitors`
  (partagés/spécifiques). Signals taggés **déterministe** (`signals.product_ids`, pas
  IA) selon les associations. Battle cards par couple `(product, competitor)`. Limite
  de products par tier (`PRODUCT_LIMIT_*`). Mono-product = transparent (selector caché).
- **Pool de providers IA légaux (patch-22)** — remplace le pool multi-comptes Groq (violait
  les ToS). `complete()` reste l'entrée unique ; pour `provider="groq"` route via `callLLM`
  vers un pool OpenAI-compatible (Cerebras free prio1, Groq prio2, Hyperbolic payant prio3),
  essayés free→payant. `pickProvider` (skip épuisés/breaker, round-robin), quota tokens/jour
  + circuit breaker par provider ET global en Redis (partagé entre runs) ; failover en-appel
  sur 429/5xx. Sans Upstash : « 1er provider, pas de tracking ». Claude = fallback
  `provider="claude"` (swap 1 ligne). Breaker ouvert → banner ai-status, scrapes continuent.
  Rate limit intelligent (staleness) + dur (10/h/user). `ai-capacity-check` alerte ops 80/90%.
- **Cascade scraping découplée (patch-20)** : fingerprint navigateur (Patchright/
  Camoufox) et réputation IP (datacenter/residential) escaladés séparément, du gratuit
  (L0 fetch, L1 Patchright sans proxy) au payant (L2 datacenter, L3 residential, L4
  Camoufox). Escalade routée par type d'échec. Apprentissage `monitor.requiresLevel`
  pour démarrer la cascade au bon niveau ; re-probe 14j pour redescendre. Pas de coût
  par requête (ScrapingBee/Webshare supprimés).
- **Reschedule adaptatif** : `computeNextRun()` dans `@outrival/shared` ralentit
  les monitors stables (×4 max). La fréquence utilisateur = plafond, pas valeur fixe.
- **Analytics best-effort** : les tables time-series (ex-ClickHouse) vivent dans la
  même base Postgres (Neon). Les writes (workers `lib/analytics.ts`) et reads (API
  `lib/analytics-safe.ts`) sont best-effort — une erreur de logging/lecture ne casse
  jamais un scrape, un job IA ou un handler (l'UI dégrade gracieusement). ClickHouse
  a été retiré (un seul Postgres, moins d'infra à opérer).
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
