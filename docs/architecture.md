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
| ProductCompetitor     | Junction product↔competitor (patch-28) — competitors au niveau Org ; la LIGNE est l'appartenance (lié à N products = suivi pour N products). Pilote le tagging signals + les feeds par product |

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
| Jobs              | **pg-boss v12** self-hosted (`@outrival/queue`)     | Postgres-natif : 0 € de logiciel, pas de compteur par run, pas de cap à 10 crons, pas de risque roadmap vendeur. Les wrappers Trigger.dev survivent une semaine après le cutover comme rollback, cf. `docs/trigger-to-pgboss-migration.md` |
| Scraping          | Playwright (Chromium) + fetch            | Rendu honnête : UA OutrivalBot identifiable, pas de spoofing d'automatisation, respect robots.txt (collection doctrine) |
| Parsing YAML      | `yaml` (MIT, dép de @outrival/scrapers)  | Specs OpenAPI publiées en YAML (source `docs`) — un parser maison sur un sous-ensemble YAML casserait en silence sur les ancres / blocs multi-lignes |
| Egress proxy      | ProxyScrape datacenter (egress amont)    | Cascade 3 niveaux (L0 fetch · L1 render · L2 datacenter). Collection doctrine : arrêt sur refus, jamais d'escalade IP/fingerprint |
| Discovery         | Exa.ai (`exa-js`)                        | Recherche sémantique de concurrents similaires |
| Email             | Resend                                   | Alerts + digests transactionnels |
| Paiements         | Stripe (SDK v22)                         | Checkout + Customer Portal + webhooks |
| Insights IA       | Pool OpenAI-compat (`gpt-oss-120b`)      | Cerebras p1 → Groq p2 → Hyperbolic p3. `tier:"fast"` → `gpt-oss-20b` (Groq seul). Les llama-3.x sont arrêtés par Groq le 2026-08-16. `AI_CONFIG.model` est ignoré sur le chemin pool |
| Déploiement       | OVH VPS + Coolify                        | Self-hosted, EU GDPR, €8/mois |

> **Note** : Upstash Redis a été retiré du stack (Phase 6). Les alertes temps-réel
> passent par SSE DB-backed (poll Postgres 3s + heartbeat), latence ~3s suffisante
> pour de la veille. À ré-introduire uniquement si besoin de rate-limiting API.

## Infrastructure

```
OVH VPS (4 vCPU / 8GB RAM / 80GB SSD) — €8/mois
└── Coolify (PaaS self-hosted)
    ├── @outrival/web     → outrival.io        (:3000) Next.js 16
    ├── @outrival/api     → api.outrival.io    (:3001) Hono + Bun
    ├── @outrival/workers → pg-boss : 2 services, WORKER_ROLE=light (crons/IA/
    │   extracts/alerts, ~1 Go) et WORKER_ROLE=browser (scrapes/platform/PDF,
    │   4-5 Go, shm-size 1g). Le light possède seul cron + maintenance.
    └── queue-postgres    → Postgres dédié always-on (~512 Mo) — schéma `pgboss`
        UNIQUEMENT (QUEUE_DATABASE_URL). JAMAIS Neon : un poller sub-2s défait le
        scale-to-zero et facture des compute-hours. Créé par boss.start().

Neon (EU) — €0 free tier → ~$19/mois (Launch) à l'échelle
└── PostgreSQL — relationnel + time-series/analytics (ex-ClickHouse) dans une
    seule base. Connexion via le pooler (`-pooler`, ?sslmode=require). La queue
    pg-boss (QUEUE_DATABASE_URL) utilise un Postgres dédié always-on distinct,
    jamais cette branche Neon.

Cloudflare R2 — ~€1/mois
└── Snapshots HTML, screenshots, PDFs battle cards

Heartbeat externe (Better Stack / UptimeRobot) — €0
└── Le worker light ping HEARTBEAT_URL toutes les 5 min ; le monitor alerte quand
    les pings S'ARRÊTENT. Seule alerte qui survit à la mort du VPS ou de la queue.

ProxyScrape — datacenter ~$10/mois (flat, BW illimitée, egress amont — collection doctrine)
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
                       default_sources (jsonb SourceType[] — migration 0053, sources
                       semées sur un NOUVEAU competitor ; null = jeu built-in, donc
                       élargir le défaut atteint toute org qui n'a rien personnalisé.
                       Narrowed par le plan au moment du semis, cf. Provisioning),
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
                       last_changed_at, created_at,
                       scrape_started_at (ENQUEUED — stamped by the API/seeder),
                       scrape_picked_up_at (migration 0052 — stamped by the WORKER when
                       the handler actually starts). Both cleared on every terminal
                       outcome. The gap between them IS the queue wait, and it is what
                       lets the UI say "Queued" instead of claiming to scan a page no
                       worker has opened. Measured on prod 2026-07-27: p50 51s but 25 of
                       149 seeded monitors waited >5 min and one waited 60 min

snapshots              id, monitor_id, r2_key, content_hash, scraped_at,
                       status (success|failed|partial), etag, last_modified,
                       resolved_url, homepage_structure (jsonb — patch-16, homepage only),
                       screenshot_phash (hex dHash — patch-17), content_size (patch-17),
                       origin (live|archive — L2 archive backfill : "archive" =
                       capture Wayback reconstruite à l'onboarding, scraped_at
                       backdaté, invisible au diff latest-snapshot ; migration 0025)

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
                       temperature, sent_at, created_at,
                       faithfulness (jsonb — rapport claim-level ; verdict='blocked'
                       = digest stocké mais email JAMAIS envoyé, sent_at null)

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
                       editables), faithfulness (jsonb — rapport claim-level ; une
                       carte bloquée n'est jamais écrite, donc une carte stockée
                       porte toujours un rapport pass|skipped), pdf_r2_key,
                       flagged_for_regeneration_at (patch-21),
                       based_on_user_update_at, based_on_competitor_signal_at (patch-22 —
                       staleness : inputs au moment de générer), product_id (patch-28),
                       generated_at, updated_at
                       — patch-28 : unique (product_id, competitor_id) ; une carte
                       par couple product↔competitor (plus competitor_id seul)

products               id, org_id, name, self_competitor_id (unique — l'ancre de
                       monitoring type=self ; url/profil/pricing/monitors y vivent),
                       is_primary, status (active|paused|archived), position,
                       created_at, updated_at  — patch-28, multi-SKU (wrapper fin)
product_competitors    product_id, competitor_id (PK composite),
                       relevance_score, created_at  — patch-28, junction org-level.
                       `is_specific` DROPPÉ (migration 0053) : chaque lien était
                       écrit shared, donc le flag étiquetait faux le cas courant et
                       répondait à une question que les lignes répondent déjà

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
                       + materiality (jsonb {decisionImpact, urgency, corroboration},
                       0-3 chacun — taxonomie v2 : les sous-scores dont `severity`
                       est la fonction déterministe. Null sur les classifications
                       SYNTHÉTISÉES (HN, wellknown, comparison_page, pricing
                       transition) et sur tout signal antérieur)
                       + faithfulness (jsonb — rapport claim-level du gate de
                       publication : {verdict, ratio, claims[], unfaithfulClaims[],
                       durationMs}. Rempli sur les insights critical|high seulement ;
                       verdict='blocked' ⇒ filtered_reason='faithfulness_blocked',
                       jamais d'email/Slack)
changes                + relevance_score (real, nullable — max des changes significatifs,
                       structured homepage only) — patch-26
                       + suppression_reason (text, nullable — taxonomie v2 :
                       'cosmetic' = le gate sémantique a jugé le fait inchangé, le
                       change est gardé pour l'audit mais n'a jamais été classifié)
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

standing_queries       id, org_id, user_id, question, context (jsonb),
                       watched_competitor_ids / watched_categories (jsonb — entités
                       extraites UNE fois à la création depuis les citations ; vides =
                       wildcard org / toute catégorie), min_severity (seuil de
                       matérialité), cooldown_hours (def 6), current_answer /
                       current_citations / current_signal_ids / current_hash (baseline =
                       ensemble trié des signaux cités — la détection de changement ne
                       diffe JAMAIS le texte), pending_count (hystérèse : alerte à la 2e
                       éval matérielle consécutive), last_evaluated_at, last_alerted_at,
                       last_change_summary, is_active — question Ask sauvegardée et
                       surveillée (migration 0036). Réévaluée en aval de generate-signal
                       (déclenchement ciblé, pas de cron), via POST /api/internal/ask/run
                       (même pipeline Ask, INTERNAL_API_SECRET). Cap par plan
                       (PLAN_LIMITS.standingQueries 3/10/999/999, 403
                       plan_limit_standing_queries). 📄 docs/ask-outrival.md
```

### Enums Postgres
```
plan              free | starter | pro | business
billing_period    monthly | yearly
source_type       homepage | pricing | blog | changelog | jobs |
                  g2_reviews | capterra_reviews | appstore_reviews |
                  trustpilot_reviews | trustradius_reviews | gartner_reviews |
                  playstore_reviews | linkedin | twitter | github_repo |
                  tech_stack | status | sitemap | news | custom
                  — reviews+ (trustpilot/trustradius/gartner/playstore) : patch-32, enable
                    on-demand pro+, même chemin que g2/capterra. reddit : RETIRÉ (2026-07-14,
                    migration 0043) — Public Content Policy Reddit (usage commercial sans licence
                    interdit) + creds free-tier non obtenables (Responsible Builder Policy). Valeur
                    retirée des enums source_type + review_source ; couverture communautaire de
                    l'ICP founders/dev assurée par hackernews.
                  — internes, jamais user-selectable : tech_stack (patch-18, infra, tab
                    read-only), sitemap + news (patch-32, semés weekly, diff = pages/
                    événements neufs), ai_visibility/subdomains/youtube (ancres
                    synthétiques), review_shift (ancre du signal d'inflexion de thèmes
                    de plaintes, jamais scrapée), hiring_shift (ancre du signal
                    d'inflexion de vélocité de recrutement par département, jamais
                    scrapée), hackernews (mention-tracking HN via l'Algolia public,
                    semé weekly ; garde anti-homonyme STRICTE = domaine obligatoire sauf
                    competitor.metadata.ambiguousName===false ; Show HN+domaine →
                    product/high, mention > HN_POINTS_THRESHOLD → content/medium, en
                    dessous stocké sans signal ; sévérité FORCÉE par-hit — branche dédiée
                    scrape-monitor, dédup par objectID, pas de classifieur, lien thread
                    toujours attaché), wellknown (empreinte publique du domaine racine,
                    semé weekly ; /.well-known/apple-app-site-association + assetlinks.json
                    → app mobile launch product/high, filtre IdP anti-faux-positif ;
                    /llms.txt → api_developer/low ; branche dédiée, sévérité forcée,
                    empty=valide), comparison_page (ANCRE interne de sitemap v2, jamais
                    semée/scrapée — porte le change→signal déterministe d'une page /vs/ +
                    source dédiée pour le carve-out du garde critical). status : on-demand
                    starter+ (patch-31).
                  — docs : documentation développeur du concurrent (user-selectable,
                    pro+, weekly, override d'URL optionnel). STRUCTURED-FIRST, 2 modes :
                    (1) spec OpenAPI/Swagger trouvée (JSON ou YAML — dép `yaml`) →
                    snapshot = listing CANONIQUE trié des opérations + schémas, donc le
                    diff lexical générique EST un diff structurel (endpoint ajouté/
                    supprimé, champ passé `deprecated`, marqueur `[BETA]`) — ZÉRO IA
                    dans le diff, l'IA ne paie que le « so what » ; (2) pas de spec →
                    liste de pages du sitemap docs (page neuve = feature nouvellement
                    documentée) + empreinte de contenu sur les K premières pages
                    (`DOCS_PAGE_HASH_*`) pour capter une page RÉÉCRITE. Aucune branche
                    scrape-monitor (chemin générique), fetch pur (pas de navigateur).
                    Garde anti mode-flip : une spec n'est « absente » que sur réponse
                    définitive (4xx / corps non-spec) — tout échec transitoire throw
                    `spec_probe_failed` plutôt que de dégrader en mode 2 (sinon le diff
                    lirait « tout supprimé, tout ajouté »). `no_docs_surface` = fait
                    neutre (NO_TARGET_MARKERS → `not_available`), `no_docs_index` =
                    échec actionnable (l'user peut pointer une URL). 📄 docs/docs-source.md
                  — custom : page arbitraire du domaine enregistrable (eTLD+1) du
                    concurrent, user-selectable via un flow DÉDIÉ (« Watch a custom page »,
                    POST /:id/custom-monitors — pas la liste standard d'enable). config =
                    {url, label, hint} ; pipeline générique snapshot → diff lexical →
                    classify → signal (le hint grounde classify). Plusieurs customs par
                    concurrent (quota PLAN_LIMITS.customMonitorsPerCompetitor 0/2/5/10,
                    gate backend plan_limit_custom_monitors ; unicité applicative sur l'URL
                    normalisée, PAS (competitor,sourceType)).
                    Comportement détaillé : cf. Pipeline + Décisions.
frequency         realtime | daily | weekly
signal_severity   low | medium | high | critical
signal_category   pricing | product | hiring | reviews | content | funding | api_developer
                  | partnerships | ma | leadership | security_compliance | ads
                  — api_developer (sitemap v2 / wellknown) : surface developer/AI-agent.
                    Émis UNIQUEMENT de façon déterministe (llms.txt d'un concurrent) ;
                    absent du prompt classify → le modèle ne le choisit jamais (zéro
                    perturbation de l'éval catégorie). Couleur --cat-api-developer (web)
                  — taxonomie v2 (matérialité) : partnerships / ma / leadership /
                    security_compliance / ads sont CHOISIES PAR LE MODÈLE (dans le
                    prompt classify, contrairement à api_developer). Elles découpent
                    le fourre-tout « content » en mouvements company-level, détectés
                    sur les sources DÉJÀ scrapées (blog / news / changelog) — aucune
                    source nouvelle. Chacune porte un PLANCHER de sévérité
                    déterministe (applyCategoryFloor, packages/ai/src/tasks/
                    materiality.ts) : ma→critical, security_compliance→high,
                    partnerships→high si intégration produit sinon medium,
                    leadership→high si C-level sinon medium, ads→medium. `ma` est la
                    seule ajoutée à CRITICAL_CATEGORY_ALLOWLIST (severity-guard) —
                    sans ça son plancher critical serait démoté systématiquement
notification_type signal | new_competitor | self_change | onboarding_complete |
                  structural_change | silent_monitor | analysis_ready | standing_query
                  (silent_monitor = patch-27, source sans signal depuis 60j+ ;
                   1/org/30j via le dispatcher patch-26. standing_query = question
                   surveillée dont la réponse a matériellement changé, migration 0036)
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
hiring_metrics      competitor_id, department_bucket, open_count, week_start,
                    recorded_at — hiring-velocity : open-role count PAR bucket
                    canonique (8 buckets + unknown) et PAR semaine ISO. Unique
                    (competitor, bucket, week_start) → UPSERT (un re-scrape la même
                    semaine écrase, jamais de doublon). Écrit seulement sur run ATS
                    autoritatif ; alimente les sparklines Hiring + le détecteur d'inflexion
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
backfill_runs       monitor_id, competitor_id, source_type, outcome (self|
                    no_live_snapshot|no_url|no_current_html|no_archive_capture|
                    no_significant_change|change_triggered|error), detail,
                    archives_seeded, change_triggered (0/1), duration_ms,
                    recorded_at — audit 2026-07-10, buckets de miss du SLO
                    first-signal (docs/slos/onboarding-first-signal.md)
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
| pro       | 15              | + g2_reviews, capterra_reviews, docs                   | realtime      | + webhook               | battleCards, realtimeAlerts |
| business  | ∞               | + appstore_reviews                                     | realtime      | email + slack + webhook | + api, multiUser |

Codes d'erreur structurés sur les routes gating : `plan_limit_competitors`,
`plan_locked_feature`, `plan_locked_source`, `plan_locked_frequency`,
`plan_locked_channel`. Le web parse via `paywallFromError(err)` et affiche
`<PaywallDialog>`.

## Provisioning des monitors

Un competitor n'a pas automatiquement un monitor par source. Trois chemins de création :

- **Création manuelle** (`POST /api/competitors`) et **ajout depuis candidate**
  (`candidates.ts`) → même helper (`apps/api/src/lib/seed-monitors.ts`, une seule
  liste : les deux chemins avaient divergé, `sitemap` n'était semé que par le manuel).
  Sème le **jeu de sources par défaut de l'org** narrowed par le plan
  (`resolveSeedSources`, `@outrival/shared/sources/defaults`) + les ancres internes
  (`sitemap`/`news`/`subdomains`/`youtube`/`hackernews`/`wellknown`, weekly, jamais
  user-selectable).
  - Jeu par défaut (`organizations.default_sources` null = built-in) = `homepage`,
    `pricing`, `blog`, `jobs`, `docs`, `roadmap` — **le gating par plan est le
    garde-fou** : free retombe exactement sur les 3 sources historiques, starter
    ajoute `jobs`, pro/business ajoutent `docs` + `roadmap`. `homepage` est toujours
    semée (ancre de la détection plateforme, de l'extraction de profil, de la
    découverte pricing et du diff visuel).
  - Ne sont JAMAIS semés à l'aveugle : `status`/`changelog` (la détection plateforme
    les sème déjà **avec l'URL résolue** quand la surface existe),
    `appstore_reviews`/`github_repo` (URL obligatoire → la ligne ne pourrait
    qu'échouer), `trustpilot_public` (dépend de `TRUSTPILOT_API_KEY`), `custom` (flow
    dédié).
  - Réglage + rattrapage : `GET/PATCH /api/settings/sources` (liste cochable dans
    Settings → General, une source au-dessus du plan est **stockée quand même** →
    elle s'applique le jour de l'upgrade) et `POST /api/settings/sources/apply`
    (ajoute les sources manquantes sur les competitors existants — ADD only,
    idempotent, jamais le self-product ni un competitor soft-deleted). Le même
    payload (`gaps`) alimente le bandeau dashboard « votre plan couvre X sources que
    N concurrents ne surveillent pas encore » : acheter un plan n'ouvrait aucune
    source sur l'existant, la capacité restait à réclamer à la main, concurrent par
    concurrent.
  - `docs`/`roadmap` étant désormais semés en masse, leurs absences stables
    (`no_docs_surface`, `no_roadmap_portal`, `portal_private`, `portal_empty`) sont
    des **benign skips** dans `scrape-monitor` : pas de 3-strike, pas de
    `markedUnscrapable`, statut `skipped`. Le motif reste écrit dans
    `monitors.last_error` (avec `last_failed_at` nettoyé) — c'est la seule évidence
    que la surface n'existe pas, et ce que `sourceState` lit pour afficher
    `not_available` au lieu de prétendre collecter.
- **Onboarding** (`POST /api/onboarding/complete`) → sème les sources choisies par
  l'utilisateur, gated par plan (`isSourceAllowed` → `plan_locked_source`).
- **Enable à la demande** (`POST /api/competitors/:id/monitors`) → ajoute une source
  (`jobs`, `g2_reviews`, `capterra_reviews`, …) à un competitor existant. Gated par
  plan (sinon `plan_locked_source` → paywall), idempotent (1 monitor par
  `(competitor, sourceType)`), fréquence par défaut `weekly` pour les reviews /
  `daily` sinon, clampée à une fréquence autorisée par le plan. `custom` y est
  refusé (`use_custom_monitor_endpoint`) → passer par le flow dédié ci-dessous.
- **Custom page** (`POST /api/competitors/:id/custom-monitors`) → surveille une page
  arbitraire du domaine enregistrable (eTLD+1) du concurrent, sous-domaines OK
  (`custom_url_domain_mismatch` sinon). `config = {url, label, hint}`. Quota
  **par competitor** `PLAN_LIMITS.customMonitorsPerCompetitor` (0/2/5/10 —
  `plan_limit_custom_monitors`, free = 0 = feature verrouillée), unicité
  **applicative** sur l'URL normalisée (`custom_url_duplicate`) — pas
  `(competitor, sourceType)`, donc plusieurs customs coexistent. `weekly` par défaut,
  clampée par plan.

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
  └─ cascade 3 niveaux (collection doctrine) via scrapePage : L0 fetch direct → L1 render
       navigateur (sans proxy) → L2 render via egress datacenter (choisi EN AMONT)
       └─ garde robots.txt AVANT toute requête ; UA OutrivalBot identifiable ; rate-limit
          par domaine (Crawl-delay honoré). SEUL needs_render escalade L0→L1 ; tout REFUS
          (403/503/challenge/soft_block/robots) = markedUnscrapable immédiat, ZÉRO escalade
       └─ apprentissage monitor.requiresLevel (0-4|null) + re-probe depuis L0 à 14j ;
          3 échecs consécutifs (jusqu'à L4) → monitor.markedUnscrapable
       └─ homepage (patch-16) : scroll progressif (path direct) → lazy content sous la fold
       └─ anti-vide (patch-17) : isContentCollapsed (vide absolu) + garde médiane des 5
          derniers content_size (soft-block) → throw/retry ; ne masque pas une vraie réduction
  └─ upload R2 (toujours AVANT insert DB)
  └─ insert snapshot (homepage → + homepage_structure jsonb patch-16, + screenshot_phash
       + content_size patch-17)
  └─ mobile apps (fait, JAMAIS un signal) : sur une capture homepage ou wellknown,
       `recordMobileApps` lit la présence d'app mobile du concurrent et l'écrit sur
       `competitors.metadata.mobileApps` = { ios, android }. Zéro IA, zéro scrape en
       plus. Homepage = badges de store dans le pied de page + smart app banner
       (`<meta name="apple-itunes-app">`) ; le lien App Store porte l'ID NUMÉRIQUE
       d'Apple, donc la détection pré-remplit aussi l'URL que `appstore_reviews`
       faisait coller à la main. Wellknown = repli sur le fingerprint déjà capturé :
       un package Android EST une URL Play (déterministe), un bundle iOS passe par le
       lookup public sans clé d'Apple (même famille que le flux RSS des reviews).
       Les bundles de providers d'identité sont filtrés (cf. wellknown), et une
       moitié déjà connue n'est jamais effacée par une page qui n'affiche pas de
       badge. Écriture seulement quand l'app change, merge jsonb en SQL pour ne pas
       écraser `ambiguousName`. Rendu sur l'onglet Overview + Positioning de la fiche.
       Les reviews Play Store restent HORS périmètre (retirées, collection doctrine :
       pas d'équivalent public au flux RSS d'Apple)
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
                   le contexte battle-card.
                   CANON DE PÉRIODE (`reconcileBillingPeriods`, AI-free, après extraction) :
                   `billing_period` nomme la période que le PRIX COUVRE, jamais l'engagement.
                   `yearly` = le TOTAL ANNUEL. Une page qui affiche « $16/mo billed annually »
                   était lue `yearly: 16` par n'importe quel étage, et tout l'aval divisait
                   encore par 12 (monthlyEquivalent, price ladder, médianes sectorielles,
                   battle cards lisaient $1.33/mois). Le réconciliateur restitue $192/an sur
                   deux preuves indépendantes : RATIO (un « annuel » strictement inférieur au
                   mensuel du même plan est impossible, donc ×12) et TEXTE (le montant est
                   suivi d'un token /mois dans la page, donc c'est un taux mensuel ; avec
                   « billed annually » à proximité, le total annuel dérivé est ajouté en 2e
                   ligne, si bien que les DEUX prix existent). Seul le sens yearly vers
                   monthly est réparé, celui qui SOUS-ESTIME d'un facteur 12. Le gate
                   `plausible` juge des plans réconciliés et exige donc désormais un ratio
                   9-13× ; la bande « annuel ≤ mensuel » qu'il tolérait ÉTAIT le bug. Le bloc
                   du toggle de facturation capturé au scrape est légendé « ANNUAL billing
                   selected » : sans étiquette, l'extracteur voyait un 2e jeu de montants nus,
                   indiscernable de plans mensuels moins chers)
       jobs    → extract-jobs    → diff actives + Postgres job_counts
                  (structured-first = ATS API JSON island puis JobPosting JSON-LD ; pipeline complet.
                   patch-32 : 7 ATS — Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee/Workable +
                   Personio (feed XML) ; schéma cross-ATS enrichi séniorité/datePost/salaire normalisé.
                   + Workday et iCIMS, les deux ATS d'entreprise, PAGINÉS (les 7 autres
                   rendent tout le board en une requête). Workday = JSON non authentifié
                   `/wday/cxs/{tenant}/{site}/jobs`, POST limit/offset, 20 max par page
                   (au-delà l'API renvoie vide) ; token composite `{host}/{site}`, segment
                   de locale retiré. iCIMS = pas d'API publique (la leur est authentifiée),
                   mais le portail `{slug}.icims.com/jobs/search` rend ses cartes côté
                   serveur, donc parsées en regex (ats.ts reste sans cheerio) ; pagination
                   `pr`. Chez iCIMS les colonnes dt/dd sont CONFIGURÉES PAR TENANT (l'un
                   expose Category/ID/Type, l'autre City/Company/Work Status) : titre et URL
                   de candidature sont les seuls champs garantis, le reste est lu par label
                   et best-effort. Ni l'un ni l'autre ne porte de département dans la liste,
                   le fallback titre de normalizeDepartment bucketise en aval.
                   GARDE DE TRONCATURE : un board qui rendait encore des postes quand le cap
                   de pages s'épuise renvoie `null` (repli page careers) au lieu d'une liste
                   partielle. Une liste partielle est traitée en aval comme la liste
                   AUTORITATIVE des postes ouverts, donc tout ce qui dépasse le cap serait
                   diffé comme fermé. Workday annonçant son `total` dès la 1re page, un board
                   hors cap sort en 1 requête (mesuré : 1,6s au lieu de 28s). `fetchAtsJobs`
                   distingue désormais ce cas d'un simple échec (`{jobs, truncated}`). Un
                   board HORS CAP n'est plus suivi en lien non plus, puisque n'importe quelle
                   entrée dessus est une tranche arbitraire d'une liste mondiale, alors que
                   la page de recherche LOCALE du site répond à la question posée.
                   BOARD DÉTECTÉ ≠ FIN DE PARCOURS : un board illisible (pas d'API, API
                   morte, hors cap) coupait tout le chemin de suivi de lien, donc le scrape
                   retombait sur le hub marketing en jetant la page de listing que le site
                   pointait à un clic (accenture.com/at-de/careers → /careers/jobsearch).
                   Les cibles sont maintenant essayées dans l'ordre [board, lien listing],
                   avec le MÊME test d'acceptation que le hop careers (plancher de texte +
                   `looksLikeCareers`). Plus de comparaison de LONGUEUR contre la page
                   d'origine : un hub marketing la gagne toujours contre un listing.
                   RE-DÉTECTION APRÈS HOP : la détection ATS ne tournait que sur la PREMIÈRE
                   page. Un board sur domaine vanity (`careers.exotec.com` EST un board
                   Workable) n'est nommé nulle part sur la page careers : seul le <head> de
                   la coquille SPA porte l'alternate `apply.workable.com/<token>`. Le hop
                   sonde donc d'abord en L0 et re-détecte, et quand ça résout les postes
                   viennent de l'API sans qu'AUCUN navigateur soit lancé. Workable a bien une
                   API publique (`/api/v1/widget/accounts/{token}?details=true`, board entier
                   en 1 requête). Le commentaire « no clean public API » était faux.
                   careers-link discovery élargie (labels « Jobs »/« Hiring », paths open-positions,
                   boards Notion off-site) + JOBS_RENDER_ENABLED : la page careers/board retenue et
                   les hops off-site sont rendus au navigateur (L1) + scroll, sinon les offres injectées
                   côté client — placeholder SSR « Loading positions… » — restent invisibles ; le
                   probing des paths reste en L0. Sans ça : chemin L0-only précédent.
                   HUB → LISTING : une page careers peut être un hub (culture, teams,
                   benefits) qui lie ses postes un cran plus bas (« Browse jobs » →
                   /careers/all-jobs, cf. atlassian.com, stripe.com). Le path discovery
                   s'y arrêtait (le hub RESSEMBLE à une page careers, il en est une, elle
                   n'a juste aucun poste) et le snapshot ne portait que de la copy
                   marketing. `findJobListingLink` isole les liens qui annoncent le
                   LISTING lui-même et autorise ce seul saut same-host depuis une page
                   déjà retenue ; les liens careers génériques (« Our teams », « Benefits »)
                   ne le déclenchent jamais. Un lien vers la page courante est écarté du
                   ranking, sinon l'entrée de nav « Careers » auto-référente battait le
                   vrai lien listing.
                   ATTENTE DE STABILITÉ (`SCRAPE_STABLE_*`) : atteindre la bonne page ne
                   suffit pas. Un board fetche ses lignes APRÈS hydratation et ces sites
                   émettent des beacons en continu, donc `networkidle` n'arrive jamais et
                   le settle borné expire sur le shell vide (mesuré : atlassian.com ne
                   capturait ses postes qu'1 run sur 3). Les rendus jobs attendent donc,
                   borné, que le DOM cesse de grossir. Une page déjà statique sort au
                   premier poll : coût nul là où c'est inutile)
                  (hiring-velocity : sur un run ATS AUTORITATIF, extract-jobs bucketise
                   les offres en 8 départements canoniques — normalizeDepartment pur,
                   map déterministe + fallback titre, unknown compté — et UPSERT
                   hiring_metrics (competitor, bucket, semaine ISO) ; job_counts brut
                   inchangé. Puis trigger detect-hiring-velocity-shifts, event-driven)
       g2/capt → extract-reviews → praises/complaints + Postgres review_scores
                  (structured-first scores via AggregateRating ; résumé qualitatif reste IA.
                   patch-32 : l'extraction IA renvoie en plus les sous-notes /5
                   ease_of_use/support/features/value → CH review_scores (colonnes Nullable)
                   + des THÈMES de plaintes clusterisés (IA-juge, même appel) → résumé)
                  → à l'écriture d'une row review_scores AVEC thèmes → trigger
                    detect-review-theme-shifts (event-driven, pas de cron)
       changelog → diff générique (patch-32 : feed-first — si la page expose un RSS/Atom,
                   on parse le feed → snapshot déterministe trié → le diff détecte les
                   nouvelles entrées de release ; sinon change-detection HTML, comportement actuel)
       sitemap → BRANCHE DÉDIÉE (sitemap v2, plus le diff générique) : le scraper walk
                   robots.txt Sitemap:/paths conventionnels + index multi-niveaux + .gz →
                   liste d'URLs triée (JSON island). scrape-monitor DIFFE LES SETS D'URLS
                   (loc seul — lastmod JAMAIS consulté). Nouvelle page comparative (/vs/,
                   /alternatives/, {nom}-alternative) → signal FORCÉ content/high, escaladé
                   content/CRITICAL + realtime si le slug nomme l'ORG du user (ancré sur
                   comparison_page → survit au garde). Le reste du delta d'URLs → 1 change
                   groupé → classify-change générique (comportement d'avant). Interne, weekly
       wellknown → BRANCHE DÉDIÉE : le scraper GET /.well-known/apple-app-site-association
                   + assetlinks.json + /llms.txt (L0, sans clé), filtre les bundles/packages
                   de providers d'identité (Okta/Auth0/…) et rend un fingerprint (JSON island).
                   scrape-monitor diffe le fingerprint → nouveau appID/package non-IdP = app
                   mobile launch product/high ; llms.txt apparu = api_developer/low. Sévérité
                   forcée. Empty = état valide (jamais de throw). Interne, weekly
       docs    → PAS de branche : le scraper rend un document CANONIQUE et le chemin
                   générique (extractContent → computeTextDiff → classify-change) fait le
                   diff. Mode 1 (spec OpenAPI/Swagger, JSON ou YAML) : 1 ligne par
                   opération `MÉTHODE /path — API endpoint [DEPRECATED|BETA] (params: …)`
                   + 1 ligne par schéma avec ses champs triés et leur marqueur
                   `[DEPRECATED]` → un endpoint neuf = 1 ligne `+`, un champ déprécié =
                   1 paire `-`/`+`. Caps comptés dans le header (jamais de troncature
                   silencieuse). Mode 2 (pas de spec) : liste triée des URLs du sitemap
                   docs filtrée sur la racine docs + K lignes `page <url> — …
                   fingerprint <hash>` (hash de `extractContent`, donc insensible aux
                   nonces/build ids). Découverte de la racine : sous-domaines docs./
                   developers./developer./api. → chemins /docs, /api-reference, … → lien
                   nav/footer de la home (même domaine enregistrable seulement) ; une URL
                   déjà « docs » (override user) est prise verbatim. Exempté du gate
                   cosmétique (source en forme de LISTE), inscrit dans
                   SIZE_VARIABLE_SOURCES + SYNTHETIC_DOC_SOURCES. Weekly, pro+
       hackernews → BRANCHE DÉDIÉE (pas le diff générique) : le scraper query l'Algolia
                   public HN par brand (search_by_date, fenêtre roulante HN_WINDOW_DAYS,
                   sans clé), applique la garde anti-homonyme puis rend un snapshot dont le
                   JSON island porte tous les hits guard-passing. scrape-monitor diffe les
                   sets d'objectID (snapshot courant vs précédent) → pour chaque hit neuf
                   qualifiant : 1 change + generate-signal avec une classification
                   SYNTHÉTISÉE (severity/category forcées, bypass classify-change) →
                   Show HN+domaine = product/high, mention > HN_POINTS_THRESHOLD =
                   content/medium, en dessous = stocké sans signal. Lien thread (item?id=)
                   dans humanChangeAfter + diffText. Empty = état valide (pas de throw →
                   pas de markedUnscrapable de masse). Interne, weekly)
  └─ reschedule : computeNextRun(frequency, lastChangedAt, createdAt)
       (multiplicateur ×1 / ×2 / ×3 / ×4 selon staleness — plafond MAX_INTERVAL)
  └─ L2 backfill : au 1er snapshot d'une source BACKFILL_SOURCES (competitor non-self)
       → trigger backfill-history {monitorId, competitorId, sourceType}

[on first scrape] backfill-history (L2, docs/post-onboarding-activation.md)
  └─ Wayback Machine (fetch pur, gratuit, sans clé ; @outrival/scrapers/backfill) —
       reconstruit le passé récent pour donner de la valeur "changement" au jour 0
  └─ homepage : 1 capture archive (~BACKFILL_LOOKBACK_DAYS) → R2 avant DB → snapshot
       origin=archive (scraped_at backdaté) → diff lexical vs scrape courant → change
       → classify-change (chaîne normale)
  └─ pricing : captures à 30/90/180j → snapshots archive + extract-pricing backdaté
       (seed pricing_history, skip résumé) + change au point lookback
  └─ best-effort (pas d'archive/diff → skip), ne retry jamais (insert non
       idempotent), throttlé (backfillQueue conc.2 + ~1 req/s) ; chaque issue est
       loggée dans backfill_runs (bucket outcome + detail) — plus de skip invisible

[par change] classify-change (pool gpt-oss)
  └─ GATE SÉMANTIQUE (taxonomie v2) — AVANT toute classification, sur le chemin
       lexical GÉNÉRIQUE seulement : 1 appel FAST structuré (isSubstantiveChange,
       task ai_runs `cosmetic_gate`) → « le fait a-t-il changé de substance, ou
       est-ce une reformulation / réorganisation ? ». Cosmétique → aucun classify,
       aucun signal, `changes.suppression_reason='cosmetic'` (audit + compteur
       /admin/scraping `cosmeticGate`). FAIL OPEN : null (parse miss / provider
       down / breaker) ne supprime JAMAIS. Exempts : le chemin structuré (relevance
       + volatile-lines filtrent déjà en amont), les sources en forme de LISTE
       (sitemap/subdomains/youtube/news/hackernews/wellknown/comparison_page —
       une entrée neuve est neuve par construction), et toutes les branches
       spécialisées (HN, sitemap, wellknown, pricing transition) qui appellent
       generate-signal en direct sans passer par ce job
  └─ lexical → classifyChange (fast) ; structuré (patch-16) → classifyStructuredChanges
       (smart, caché) = materiality + category + perChangeAssessment (significance/change)
  └─ rubrique MATÉRIALITÉ + règles catégorie PARTAGÉES (classify-shared.ts, une
       seule source pour les deux classifieurs). Le modèle N'ASSIGNE PLUS DE
       SÉVÉRITÉ : il score 3 axes 0-3 — decision_impact (ça change une décision
       d'achat / une action ?), urgency (interrompre vs digest du lundi),
       corroboration (combien de surfaces indépendantes — les 5 derniers signals du
       concurrent sont injectés en contexte). severity = f(sous-scores) via une
       TABLE DÉTERMINISTE TS (materiality.ts) : critical exige d=3 ET u=3 ;
       corroboration=0 démote d'une bande, ≥2 promeut d'une bande mais JAMAIS
       jusqu'à critical (pas de 2e route vers le paging). is_significant = d≥1.
       Les sous-scores sont persistés sur signals.materiality (jsonb) pour l'audit.
       Toute modif passe par l'éval étiquetée
       `pnpm --filter @outrival/ai eval:severity` (golden set prod + criticals
       synthétiques, gates : bande ≥80%, catégorie ≥85%, 0 sur-alerte critical,
       bande critical atteignable) — audit 2026-07-10 ; le rapport affiche
       désormais [d/u/c] par cas pour distinguer un mauvais scoring modèle d'une
       table mal calibrée
  └─ category + severity + isSignificant ; perChange réécrit changes.structured_diff
  └─ si significant → trigger generate-signal

[par signal candidat] generate-signal (Groq)
  └─ insight + so_what + recommended_action
  └─ patch-16 : si change structuré + severity ≥ HOMEPAGE_NARRATIVE_MIN_SEVERITY (medium)
       → narrate_change (70b, non caché, best-effort) → signals.narrative
  └─ GATE DE FIDÉLITÉ (critical|high seulement, après applySeverityGuard) :
       verifyFaithfulness(insight, diffText COMPLET) → claims atomiques → fuzzy par
       claim → juge binaire sur les indécis → ratio + verdict, stocké sur
       signals.faithfulness. `blocked` → le signal EST inséré (idempotence changeId)
       mais N'EST JAMAIS dispatché : dispatched_channel=in_app_only +
       filtered_reason='faithfulness_blocked', pas d'alerte, pas d'email de
       célébration (il cite l'insight mot pour mot) → review queue flaggée
  └─ insert signal (idempotent par changeId) + copie change.relevance_score (patch-26)
  └─ insert Postgres signal_feed (best-effort)
  └─ MODÉRATION (patch-26) : decideDispatch(orgId, {severity, relevanceScore, …}) applique
       5 couches ORG-scoped dans l'ordre — (1) seuil pertinence (skip si pas de score) ,
       (2) canal par severity, (3) quiet hours, (4) frequency cap ; critical bypasse TOUT.
       Stamp signals.dispatched_channel/filtered_reason/filtered_at. email_immediate →
       trigger send-alert (gating plan inchangé) ; sinon déféré au digest (daily/weekly)
  └─ L2 backfill : si le snapshot_before du change est origin=archive → bypass du
       dispatcher, dispatched_channel=in_app_only + filtered_reason='backfill' (jamais
       email/Slack, ne consomme pas le cap) ; badge "From archive" sur la carte signal
  └─ STANDING QUERIES : trigger ciblé evaluate-standing-queries {orgId, competitorId,
       category, severity, signalId} (fire-and-forget, jamais sur backfill)

[par signal touchant une question surveillée] evaluate-standing-queries
  └─ match : queries actives de l'org dont watched_competitor_ids/categories couvrent
       le signal (vides = wildcard), severity ≥ min_severity, cooldown écoulé
  └─ re-run de la question via POST /api/internal/ask/run (MÊME pipeline Ask, headless,
       persistHistory:false, secret INTERNAL_API_SECRET ; absent → skip propre)
  └─ ensembles de signaux cités égaux → silence (jamais de diff texte : une
       reformulation ne peut pas alerter) ; différents → juge fast standing_query_judge
       (« la substance a-t-elle changé ? », loggé ai_runs)
  └─ hystérèse pending_count : 1re éval matérielle arme, la 2e consécutive alerte →
       promotion de la réponse fraîche en baseline + decideDispatch → notification
       in-app standing_query + email si email_immediate ET realtimeAlerts (best-effort)
  └─ queue groqQueue (ne starve pas classify→signal) ; coût borné : ciblage + cooldown
       6h + juge seulement si l'ensemble a bougé

[par signal critique] send-alert
  └─ insert notification (in-app, si realtimeAlerts dans le plan)
  └─ Slack webhook (si plan + url configurée)
  └─ Email Resend (toujours, sauf erreur)
  └─ insert alerts row (avec error si échec)

[cron lundi 8h UTC] generate-weekly-digest
  └─ idempotent par (orgId, weekStart)
  └─ skip orgs sans signal de la semaine
  └─ GATE DE FIDÉLITÉ sur la sortie du MODÈLE (avant l'ajout déterministe des
       sectoralTrends / watchedQuestions, copiés verbatim d'un texte déjà formulé) :
       `blocked` → le digest est stocké avec son rapport (digests.faithfulness) mais
       l'EMAIL ne part pas (sent_at reste null) → review queue flaggée
  └─ Groq insight global → HTML inline → Resend

[cron horaire] generate-daily-digest (patch-26)
  └─ canal digest_daily (opt-in + signals déférés par quiet hours / freq cap ;
     depuis l'audit 2026-07-10, high part par défaut en email_immediate — cf.
     dispatcher — donc le daily ne porte plus que les déférés et les orgs qui
     ont choisi ce canal)
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
  └─ Groq battle card 6 sections → passe de révision (reviseBattleCard)
  └─ GATE DE FIDÉLITÉ : verifyFaithfulness(carte, battleCardEvidence(input)) —
       la MÊME évidence que la génération et la révision. `blocked` → la carte
       n'est PAS écrite (celle qui existe reste intacte), AbortTaskRunError +
       review queue flaggée avec les claims fautifs. Sinon upsert content +
       battle_cards.faithfulness
  └─ Playwright headless → page.pdf({format:"A4"}) → R2

[cron */6h] ops-health-check (patch-02)
  └─ seuils conservateurs sur scrape_runs / ai_runs / signal_feed (gardes
     d'échantillon min anti alert-fatigue) → 1 message OPS_SLACK_WEBHOOK_URL si dégradé
  └─ SLO first-signal (audit 2026-07-10, docs/slos/onboarding-first-signal.md) :
     SLI 28j/7j + coverage 24h loggés à chaque run ; alertes event-based (3 misses
     consécutifs → page, 7j<50% n≥5 → ticket, 28j<70% n≥10 → policy). Piggyback
     ici car le cap de 10 schedules Trigger est plein

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
INTERNAL_API_SECRET=         # standing queries — shared secret worker→API (POST /api/internal/ask/run),
                            # 16+ chars, MÊME valeur sur api ET workers. Vide → routes internes 404,
                            # queries sauvées mais jamais réévaluées (dégradation propre)

# Jobs
TRIGGER_SECRET_KEY=          # Trigger.dev — being replaced by pg-boss (removed at migration Phase 7)
TRIGGER_PROJECT_ID=
QUEUE_DATABASE_URL=          # pg-boss queue — DEDICATED always-on Postgres, NEVER Neon (cf. docs/trigger-to-pgboss-migration.md)
WORKER_ROLE=                 # browser | light — which queues a worker process handles
                            # QUEUE_DATABASE_URL is ALSO required on the api service (send-only:
                            # it enqueues, never executes a handler, never owns cron)
SCRAPE_CONCURRENCY=3         # scrape-monitor jobs in flight per browser worker (was 5 on Trigger's
                            # per-run machines; 3 on the shared 8 GB VPS). The slow lane no longer
                            # exists — it was retired with the L3/L4 cascade tiers
SUMMARY_CONCURRENCY=1        # competitor-summary lane (onboarding burst stays on the free AI tier)
HEARTBEAT_URL=               # dead-man's switch: the light worker GETs this every 5 min. Point it at
                            # a Better Stack / UptimeRobot heartbeat monitor that alerts when the pings
                            # STOP — the only alert that still fires if the VPS or the fleet dies.
                            # Empty → the job no-ops, logging a warning once per process (no dead-man switch is
                            # then active at all — a state that must not look healthy). Three
                            # consecutive failed pings also raise one Slack ops message, to tell
                            # "monitor unreachable" apart from "fleet dead"

# Scraping & discovery (collection doctrine — cascade L0/L1/L2, egress amont)
PROXYSCRAPE_DC_ENDPOINT=     # datacenter host:port (L2 egress amont) — optionnel
PROXYSCRAPE_DC_USERNAME=
PROXYSCRAPE_DC_PASSWORD=
SCRAPING_LEVEL_1_ENABLED=true  # kill-switch L2 (datacenter egress)
SCRAPE_MIN_DOMAIN_GAP_MS=2000  # rate-limit par domaine (défaut 2s, ou Crawl-delay robots.txt)
# Reviews v2 (2026-07-15) — Trustpilot public SURFACE (score + review count + star
# distribution) via l'API OFFICIELLE Trustpilot. Pas de surface anonyme (find + page
# publique = 403 sans clé, vérifié curl), donc la source trustpilot_public exige cette
# clé ; sans elle la route enable refuse trustpilot_public (dégradation propre) et le
# scraper throw — JAMAIS de fallback scraping (leurs CGU visent les screen scrapers).
# À poser sur api ET workers. Les agrégateurs scrapés (g2/capterra/gartner/trustradius/
# playstore) sont retirés (collection doctrine) ; g2 pourra revenir via un compte
# vendeur connecté du client (différé). Verbatims tiers jamais scrapés.
TRUSTPILOT_API_KEY=
EXA_API_KEY=
DETECT_COOLDOWN_SEC=90       # cooldown anti-double-clic (s) entre 2 runs Exa on-demand pour
                            # la MÊME cible (org+product) — PAS un cap d'usage (borné par le quota
                            # mensuel discoveriesPerMonth + le 10/h aiIntensiveRateLimit). Clé
                            # `orgId:productId` (ou `:all`) : ajouter un 2e produit ne se heurte plus
                            # au cooldown d'un autre. Avant = blocage per-org 30 min (cassait le wizard)
GITHUB_TOKEN=                # optionnel — source github_repo (self-product developing). Sans
                            # token : REST public 60 req/h partagé (rate-limit sur burst) ; avec : 5000
# Onboarding (patch-25)
NEXT_PUBLIC_ONBOARDING_PARALLEL_DISCOVERY=true   # prefetch discovery during profile edit
NEXT_PUBLIC_ONBOARDING_DISCOVERY_DEBOUNCE_MS=3000 # debounce before prefetch (limits Exa spend)
ONBOARDING_RESUME_TTL_DAYS=7                      # days an unfinished session stays resumable
# Archive backfill (L2) — reconstruct a source's recent past from the Wayback
# Machine on its first scrape (day-0 change value). Free, best-effort, in-app only.
BACKFILL_ENABLED=true                            # false → no backfill (exact prior behaviour)
BACKFILL_LOOKBACK_DAYS=90                         # age of the archive-vs-now change point
BACKFILL_SOURCES=homepage,pricing                # sources whose archive-vs-now diff is meaningful
BACKFILL_PRICING_OFFSETS_DAYS=30,180             # extra pricing_history seed points (deduped w/ lookback)
HOMEPAGE_SCROLL_PASSES=2              # patch-16 — progressive scroll passes (homepage only)
HOMEPAGE_LAZY_WAIT_MS=2000            # patch-16 — wait after each scroll pass
HOMEPAGE_NARRATIVE_MIN_SEVERITY=medium  # patch-16 — min severity to spend an AI narrative
HOMEPAGE_SCREENSHOT_ENABLED=true     # capture a homepage screenshot (floors the cascade at L1 = browser render per homepage scrape) → pHash visual-redesign + before/after visual diff. false = cheap L0 fetch, no screenshot
JOBS_RENDER_ENABLED=true             # jobs source only — render the committed careers/board page at L1 + scroll so client-injected openings (SSR "Loading positions…" placeholders) load before extraction. Path probing stays cheap L0; only the kept page + off-site hops pay a render. false = previous L0-only behaviour exactly
PRICING_TOGGLE_CAPTURE_ENABLED=true  # pricing source only — after the primary (default-period) capture, click the Monthly↔Annual toggle and append the other period's prices as a HIDDEN block so the extractor sees both periods (only the default state renders on JS pages). Best-effort + primary-capture-first (never affects the snapshot); the hidden block is stripped by extractContent (change-detection) so a flaky toggle can't fake a pricing change, but survives htmlToText for extraction. Browser levels only. false = default-period only. See docs/pricing-coverage-2026.md
PRICING_RENDER_RETRY_ENABLED=true    # pricing source only — when the L0 (no-browser) capture contains no harvestable price, re-scrape once with a browser render (local L1, no proxy). Catches client-rendered pricing pages that L0 accepts as text-rich marketing shells. false = previous L0-accepting behaviour exactly
PRICING_HARVEST_ENABLED=true         # pricing source only — L2 harvest floor (docs/pricing-coverage-2026.md Part II). When the staged extractor (structured→cache→heal→AI) returns no plans yet the page visibly carries prices, an AI-free DOM harvest recovers the entry price / band / per-card rows the SaaS-tuned AI floor drops on hosting/e-commerce/configurator layouts. Self-gating (no visible price → no-op), 0 AI. false = exactly today's behaviour (empty tiers when the AI floor finds none)
PRICING_AGGREGATE_ENABLED=true       # pricing source only — L3 product-line aggregation (docs/pricing-coverage-2026.md Part II). No /pricing page but ≥2 priced product pages / a store subdomain (hosting/e-commerce catalogs) → the pricing scraper captures the top-K (cap 3) and stitches them into ONE delimited snapshot so each becomes a "<line> · <tier>" row (extract-pricing splits per section, prefixes plan_name). Only fires with no convention pricing page + ≥2 same-registrable-domain commerce links; costs K extra browser scrapes then. false = single-page behaviour
ENRICHMENTS_PHASH_THRESHOLD=15          # patch-17 — Hamming distance → visual redesign
ENRICHMENTS_VOLATILE_THRESHOLD=5        # patch-17 — consecutive diffs → line is volatile
ENRICHMENTS_VOLATILE_RESET=10           # patch-17 — stable scrapes → analysable again
ENRICHMENTS_ANTIVOID_THRESHOLD=0.3      # patch-17 — content/median ratio → anti-void
ENRICHMENTS_RELEVANCE_MIN_SCORE=0.5     # patch-17 — min relevance score to emit a signal
SNAPSHOT_COMPLETENESS_ENABLED=true      # reliability wave 1 (R1) — grade a degraded capture `partial` (skip its diff, drop it from the anti-void median). false = exact current behaviour
SNAPSHOT_COMPLETENESS_MIN_RATIO=0.5     # R1 — content/median ratio below which a capture is graded partial (size-stable sources only; homepage also uses isIncompleteRender)
TECH_STACK_SCRAPE_INTERVAL_DAYS=30      # patch-18 — days between tech-stack scrapes per competitor
TECH_STACK_SIGNAL_MIN_IMPORTANCE=high   # patch-18 — min tech importance to emit a signal on appearance (high = payments/CRM-class tells only; medium would include hosting/marketing scripts — noisy, plan-026). Baseline (first-ever) scan of a competitor never signals, whatever this value is.
REVIEW_THEME_WINDOW_DAYS=42             # review complaint-theme shift — recent window (days) compared vs baseline for an upward inflection
REVIEW_THEME_LOOKBACK_DAYS=84           # review complaint-theme shift — total review_scores series read (baseline = lookback − window)
REVIEW_SCORE_DROP_THRESHOLD=0.2         # Reviews v2 — aggregate-score inflection fallback for surface sources (Trustpilot public: score, no verbatims/themes). When no complaint theme rises, a sustained drop of the average review score by ≥ this many points (baseline → recent window, same windows as the theme detector) emits one "reviews" signal via the detect-review-theme-shifts anchor
HIRING_SPIKE_THRESHOLD=0.5              # hiring-velocity — a department's weekly open-role count must exceed (1 + this) × its trailing 4-week average (≥4 weeks history) to emit a "hiring" inflection signal; high severity for engineering/sales, medium otherwise. Event-driven off extract-jobs (no cron slot)
HN_POINTS_THRESHOLD=50                  # hackernews source — a mention (non-Show-HN, guard-passing) must EXCEED this many points to emit a content/medium traction signal; below it the hit is stored in the snapshot JSON island but never signalled. Show HN + matching domain always signals product/high regardless.
HN_WINDOW_DAYS=30                       # hackernews source — recency window (days) bounding the HN Algolia search_by_date fetch (created_at_i > now − window), so a heavily-mentioned competitor never hits the hard 1000-hit ceiling
DOCS_PAGE_HASH_ENABLED=true             # docs source, mode 2 only (no OpenAPI spec found) — on top of the sitemap page list, fingerprint the top-K docs pages so a REWRITTEN page surfaces, not only a new one. The hash is taken over extractContent output (the exact text the pipeline diffs), so a build id / nonce can never churn it; a page that fails to fetch emits NO line (never a placeholder hash). false → page list only, K fewer L0 GETs per run
DOCS_PAGE_HASH_MAX=20                   # docs source — how many pages get fingerprinted per run. Deterministic pick (shallowest path first, then lexicographic) so the selection can't drift and fake "changed" lines; a brand-new SHALLOW page can displace the Kth, which reads as one stray removed fingerprint line next to the genuine new-page line

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

# Gate de fidélité claim-level — les sorties à enjeu (battle cards, digests hebdo,
# insights de signaux critical/high) sont décomposées en affirmations atomiques,
# chacune vérifiée contre sa citation par le MÊME validateur fuzzy que l'enveloppe
# de citations (GROUNDING_FUZZY_MATCH_THRESHOLD, inchangé), les indécises tranchées
# par un juge BINAIRE. Extraction = modèle FAST (1 appel/sortie), juge = modèle SMART
# (mesuré : le 20b accepte les claims construits sur l'ABSENCE de donnée, 5/6 sur
# l'eval étiqueté ; le 120b les rejette, 6/6 — et le juge ne tourne que sur ce que le
# fuzzy n'a pas tranché, donc le tier coûte peu là). Sous le ratio, ou
# sur un claim jugé infidèle → la sortie n'est PAS publiée (pas d'email, pas de
# Slack, pas de carte écrite) et part en review queue (/admin/ai-review-queue) avec
# les claims fautifs. FAIL OPEN : parse miss / rate limit / breaker → publication
# non vérifiée (une panne IA ne doit pas faire taire tout le produit).
# OPT-IN : tout sauf "true" → la chaîne ne tourne pas, rien n'est bloqué, zéro appel
# IA ajouté (comportement pré-gate exact). À activer seulement là où le pool est sain
# ET où `eval:faithfulness` est passé — le taux de faux blocs du juge est une propriété
# du MODÈLE, pas du code, donc il se mesure avant de mettre le gate entre une alerte
# critique et son destinataire.
FAITHFULNESS_GATE_ENABLED=false
FAITHFULNESS_MIN_RATIO=0.9         # ratio min supported/total pour publier

# Notifications
RESEND_API_KEY=
CONTACT_EMAIL=               # inbox for the public landing /demo lead form (default hello@outrival.app)

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
UNSCRAPABLE_REARM_DAYS=7                # re-probe d'un monitor markedUnscrapable (isActive:false
                                       # à 3 échecs) tous les Nj → une panne transitoire ne tue
                                       # plus le monitor définitivement (schedule-scraping)

# Self-product multi-SKU (patch-28)
PRODUCT_LIMIT_FREE=1                    # max products (SKUs) actifs par org / tier
PRODUCT_LIMIT_STARTER=2
PRODUCT_LIMIT_PRO=5
PRODUCT_LIMIT_BUSINESS=999

# Staged extraction pipeline (patch-30)
STAGED_EXTRACTION_ENABLED=true         # false → bypass des étages, comportement actuel exact (plancher)
EXTRACTOR_HEAL_COOLDOWN_HOURS=12       # min heures entre 2 self-heal sur un extracteur cassé (anti-thrash)
EXTRACTOR_REVALIDATE_INTERVAL_DAYS=14  # R8 — âge max d'un parser caché avant régénération forcée contre le DOM courant (un sélecteur dérivé "plausible mais faux" ne peut plus être trusté indéfiniment). last_validated_at n'est plus stampé à chaque cache hit
EXTRACTOR_MAX_CONSECUTIVE_FAILURES=5   # R8 — échecs de replay consécutifs après lesquels un parser caché est distrusté d'office
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
# moteurs IA. Feature premium (features.aiVisibility, pro+). gemini = moteur par défaut
# GRATUIT (Google Search grounding : sur free tier le grounding n'existe que sur 2.5
# flash/flash-lite, celui des Gemini 3.x est réservé au tier payant. Le « 5k prompts/mois
# gratuits » longtemps écrit ici décrivait donc le tier PAYANT. Et le cap de requêtes DU
# MODÈLE mord avant celui du grounding : MESURÉ en console 5 RPM / 20 RPD, pas les 500 RPD
# annoncés — soit ~1 org/jour à 10 prompts par produit. Lire aistudio.google.com/rate-limit,
# jamais la page pricing, avant de dimensionner quoi que ce soit ici)
# → active sans payer. Chaque moteur best-effort (vide → skip, 0 coût). Stratégie coût-zéro
# (BYOK, scrape-cascade AIO) : 📄 docs/ai-visibility-free.md — 📄 docs/ai-visibility.md
# L7 teaser (docs/post-onboarding-activation.md) : dérivé GRATUIT non-gaté — 1 run/org à
# l'onboarding (job `ai-visibility-teaser`, event-triggered depuis /complete) écrit 1 ligne
# `ai_visibility_teasers` (org unique = garde one-run), lue non-gatée par GET /api/ai-visibility/teaser
# → carte day-0 sur le landscape. Gemini free, ≤3 prompts, best-effort (ligne terminale
# ready|unavailable). Cache réponses cross-org différé (coût déjà ≈0 via free tier).
AI_VISIBILITY_ENABLED=true             # false → scheduler + job no-op (kill-switch)
AI_VISIBILITY_INTERVAL_DAYS=7          # cadence par org (jours entre 2 runs)
AI_VISIBILITY_MAX_PROMPTS=10           # cap prompts/org/run (garde-fou coût)
AI_VISIBILITY_MIN_PROMPTS_FOR_SIGNAL=4 # min prompts répondus (par moteur, sur les DEUX runs) avant qu'un shift SoV soit signalé — sinon skip (1-2 prompts = quota gratuit épuisé, bruit 100%/50%, pas un vrai mouvement)
AI_VISIBILITY_MIN_REQUEST_GAP_MS=13000 # espacement min entre 2 appels au MÊME moteur. Le free tier
                                       # plafonne aussi PAR MINUTE : un jeu de prompts tiré en rafale
                                       # 429 en cours de run, ce que le garde quota lit comme une
                                       # enveloppe épuisée et qui tue le moteur pour tout le run.
                                       # Le défaut vise le plafond MESURÉ (5 RPM), pas l'annoncé.
                                       # Ne baisser que sur un tier payant (plafonds plus hauts)
AI_VISIBILITY_TEASER_ENABLED=true      # L7 — teaser onboarding gratuit 1×/org (false → "unavailable")
AI_VISIBILITY_TEASER_MAX_PROMPTS=3     # requêtes groundées free dépensées par teaser
GEMINI_API_KEY=                        # moteur Gemini + grounding (GRATUIT, défaut) ; vide → skip
AI_VISIBILITY_GEMINI_MODEL=gemini-2.5-flash  # PINNER une version, JAMAIS un alias `-latest` : le
                                       # quota grounding gratuit est PAR MODÈLE, et l'alias qui
                                       # glisse sur une génération sans quota renvoie 429 sur tout
                                       # appel groundé (panne 13/07→24/07/2026, 0 ligne 11 jours)
PERPLEXITY_API_KEY=                    # moteur Perplexity Sonar (PAYANT) ; vide → moteur skip
AI_VISIBILITY_PERPLEXITY_MODEL=sonar   # modèle Perplexity (sonar = search fee le moins cher)

# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=  # build-time — in-app Payment Element (card update). Vide → dialog dégradé
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_YEARLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_BUSINESS_MONTHLY=
STRIPE_PRICE_BUSINESS_YEARLY=

# Public
NEXT_PUBLIC_API_URL=         # https://api.outrival.io
WEB_URL=                     # https://outrival.io (callbacks Stripe)

# Build provenance (Docker build args for @outrival/web, inlined at build time)
GIT_SHA=                     # deploying commit sha → surfaced by GET /api/version (stale-deploy check)
BUILD_TIME=                  # build timestamp → GET /api/version. In Coolify: pass SOURCE_COMMIT as GIT_SHA
```

## Décisions architecturales clés

- **Attendre son tour est un état, pas un scrape (2026-07-27)** — l'UI stampait
  `scrape_started_at` à l'ENQUEUE et appelait ça « Scanning the site », alors que
  le travail commence quand un worker prend le job. Sur prod, ajouter ~10
  concurrents sème 149 monitors : p50 51s d'attente, mais 25 au-delà de 5 min et
  un à 60 min (source `jobs` d'Accenture : 35 min d'attente pour un scrape de
  13s). Trois conséquences, corrigées ensemble. (1) Le worker stampe
  `scrape_picked_up_at` : « Queued » (horloge) et « Scanning » (spinner) sont
  désormais deux états distincts, dans `deriveAnalysisStatus` comme sur la ligne
  de source. (2) Les plafonds de fraîcheur sont séparés — 15 min pour un job
  PRIS, 60 min pour un job EN ATTENTE. L'ancien plafond unique de 5 min faisait
  disparaître l'état en cours pile quand l'attente devenait longue, donc la
  source repassait « stale » alors qu'elle était toujours dans la queue : le
  symptôme exact qui faisait relancer à la main. (3) Les enqueues déclenchées par
  un user portent `USER_SCRAPE_PRIORITY` ; le fan-out horaire reste à 0, donc un
  clic ne fait plus la queue derrière ~1200 monitors de cron.
  `scrape-monitor.expireInSeconds` passe de 300 à 900 : un run mesuré à 302,7s
  franchissait déjà la ligne, et pg-boss ne peut PAS interrompre un handler JS —
  l'expiration ne coupait rien, elle dupliquait le scrape le plus lent et laissait
  la ligne monitor marquée en vol sans échec pour l'expliquer.
- **La sévérité quitte le modèle (taxonomie v2 — matérialité)** — le classifieur
  choisissait librement une bande à partir d'une rubrique en prose, ce qui faisait
  de la sortie la plus lourde de conséquences du pipeline (un `critical` bypasse
  toute la modération et envoie un email en minutes) un jugement qui dérive avec le
  provider et la formulation du diff. Le modèle score maintenant **3 axes
  observables 0-3** (decision_impact / urgency / corroboration) et ne nomme jamais
  de bande ; `severity` est une **fonction TS déterministe** de ces scores
  (`packages/ai/src/tasks/materiality.ts`), donc reproductible, testée à ses bords
  et relisible en diff. Trois garde-fous : la seule route vers `critical` reste
  d=3 ∧ u=3 (la corroboration promeut au plus jusqu'à `high`) ; `is_significant`
  dérive du même chiffre (d≥1) au lieu d'être un 2e jugement qui pouvait
  contredire la sévérité ; les sous-scores sont persistés (`signals.materiality`)
  pour que la bande soit explicable après coup. Le modèle garde la **catégorie**
  (un appel sémantique où il est bon). UN SEUL classifieur : la rubrique remplace
  l'ancienne dans `classify-shared.ts`, partagée lexical + structuré. Cache
  invalidé par bump de namespace (`withAiCache` ne re-valide pas une entrée
  stockée, les anciennes n'ont pas de sous-scores). 12 catégories : 5 ajouts
  company-level (partnerships / ma / leadership / security_compliance / ads) sur
  les sources déjà scrapées, chacune avec un plancher de sévérité déterministe.
- **Gate sémantique avant classification (taxonomie v2)** — `evaluateSignificance`
  ne sait éliminer que les diffs SANS contenu (hashes, timestamps, nonces) ; il ne
  peut rien contre un diff plein de vraie prose qui ne dit rien de neuf — la passe
  de copy d'une équipe marketing, que le classifieur appelle fidèlement un
  « repositionnement ». Un appel FAST structuré s'insère donc dans
  `classify-change` (le seul goulot du chemin générique — les branches
  spécialisées appellent `generate-signal` en direct et sont exemptées gratuitement)
  et tranche : substance changée, ou reformulation ? Cosmétique → le change est
  gardé avec `suppression_reason='cosmetic'` (jamais supprimé : une suppression
  invisible est indétectable, le compteur `/admin/scraping` la rend auditable),
  aucun signal. **Fail open** par construction (prompt biaisé « substantive » +
  null ⇒ on classifie) : rater une reformulation coûte un signal bruyant, en
  supprimer une vraie la perd en silence.
- **Vérification claim-level + gate binaire avant publication** — le grounding
  existant (patch-24) NOTE la qualité d'une sortie (score de citations, confidence,
  self-check) mais ne l'arrête jamais : une carte avec une phrase inventée partait
  quand même, avec un point de confiance. Le score est aussi agrégé — un ratio de
  0.8 ne dit pas QUELLE phrase est fausse, donc personne ne peut agir dessus. La
  chaîne ajoutée décompose chaque sortie à enjeu en **affirmations atomiques** (1
  appel FAST structuré), vérifie chacune **avec le validateur fuzzy existant appelé
  claim par claim** (même seuil, même algo — la granularité change, pas la règle),
  et confie les indécises à un **juge BINAIRE** (fidèle / infidèle + une ligne de
  raison ; le schéma refuse une échelle, sinon la décision retombe sur le lecteur
  du chiffre). Le verdict est un **gate** : sous `FAITHFULNESS_MIN_RATIO` ou sur un
  claim infidèle, la sortie ne part pas — pas d'email, pas de Slack, pas de carte
  écrite — et atterrit dans la review queue EXISTANTE (`ai_quality_checks`,
  colonne `faithfulness`) **avec les phrases fautives nommées**. Le blocage vise la
  frontière SORTANTE, jamais la génération : le signal est inséré (l'idempotence
  par `changeId` est porteuse) et reste lisible in-app, seul l'envoi est retenu.
  **Fail open** par construction (parse miss / rate limit / breaker ⇒ verdict
  `skipped` ⇒ publication) : une panne IA ne doit pas faire taire tout le produit.
  Périmètre = ce qui a un coût de faux : battle cards, digests hebdo, insights
  critical/high — pas medium/low (coût), pas Ask (déjà grounded en two-pass). V1
  mono-échantillon ; le multi-sampling type SelfCheckGPT est noté en option future
  dans `faithfulness/verify.ts`, à décider sur le taux de faux blocs mesuré dans la
  review queue. Comportement du juge mesuré hors CI par
  `pnpm --filter @outrival/ai eval:faithfulness` (paires étiquetées : 100% des
  inventions rejetées, ≥80% des paraphrases gardées).
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
- **Capability liveness readout (plan 021)**: `GET /api/admin/capabilities`, rendered
  on `/admin/system`, answers behaviourally whether each optional capability (archive
  backfill, staged extraction, platform detection, AI Visibility, the faithfulness
  gate, standing queries, share links, the CRM webhook, Ask, signal comments, saved
  views, passkeys) has actually written a row recently, plus two directly-read entries
  (visual diff, multi-user). Booleans and counts only, never an env value: the API and
  the workers are separate environments, so an API-side read would be meaningless for
  a worker-owned switch. 📄 docs/capability-activation.md
- **Public share links — "Competitive Snapshot Report" (L7/L8, feature ad-hoc)** — lien
  public read-only révocable d'un artefact (v1 : le landscape par product). Table
  `share_links` (org_id, type, product_id, token unique, created_by, revoked_at ;
  migration 0027) = capability non-devinable, révocable (soft `revoked_at`), défaut OFF
  (créée sur action explicite). L'assemblage landscape (Lever 1) est extrait en
  `lib/landscape-data.ts` `buildLandscape(orgId, productId?)`, réutilisé par la route
  authed `/api/landscape` ET la route **publique non-gatée** `GET /api/public/report/:token`
  (montée hors authMiddleware ; le token résout 1 org+product, 0 surface tenant). Rendu :
  `app/report/[token]` server-component, `noindex` + `robots` disallow `/report/`, footer
  "Powered by Outrival" (boucle d'acquisition). Bouton "Share snapshot" sur le landscape
  (create-or-return idempotent + copie presse-papier), liste révocable dans Settings → Data.
  📄 docs/post-onboarding-activation.md
- **Monthly "Competitive Recap" — Wrapped (L9, feature ad-hoc)** — recap mensuel style
  year-in-review. `buildMonthlyRecap(orgId, month?)` (`lib/monthly-recap.ts`, pur, depuis
  signals/quality_feedback/scrape_runs — 0 table) → `GET /api/recap` + page in-app
  `/dashboard/recap` = slideshow animé (motion/react : count-ups, reveals, progress dots,
  nav clavier/tap). Email teaser (`send-monthly-recap` job) = hook vers la page (l'email
  n'anime pas). Scheduling SANS nouveau cron (cap 10/10 plein) : piggyback
  generate-daily-digest au 1er du mois local de l'org, idempotency-key /org/mois.
  **Partageable** via l'infra L8 : `share_links.type='recap'` + `meta{month}` (migration
  0029), public résout `kind='recap'` → `RecapDeck publicMode` (mêmes cartes, sans liens
  dashboard). 📄 docs/post-onboarding-activation.md
- **Couverture des sources élargie (patch-32)** — étend la couverture par source via la
  détection plateforme (patch-31) + le pipeline étagé (patch-30), sans toucher la cascade.
  **HIRING** : 7 connecteurs ATS no-auth (+ Personio feed XML) + schéma d'offre cross-ATS
  enrichi (séniorité/datePost/salaire normalisé via `normalizeSalary`) → 5 colonnes
  `job_postings` (null sur fallback LLM). **PRICING** : gate `plausible` ratio mensuel↔annuel
  (sinon retombe sur l'IA). **SIGNALS** : changelog **feed-first** (RSS/Atom → snapshot trié)
  + nouvelle source interne **sitemap** (diff = pages neuves/retirées). **REVIEWS** : sous-notes
  /5 (ease_of_use/support/features/value → review_scores Nullable) + thèmes de plaintes
  (IA-juge, même appel) ; **multi-plateforme** — 4 sources (trustpilot/trustradius/gartner/
  playstore, enable on-demand pro+, URL brand-locked). **HOMEPAGE** : `og:image`/`og:type` →
  `meta_changed` (rebrand).
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
  self-competitors. Concurrents au niveau Org, liés via `product_competitors` — la
  LIGNE est l'appartenance, un concurrent suivi pour deux SKU a deux liens (le flag
  `is_specific` est droppé, cf. décision ci-dessous). Signals taggés **déterministe**
  (`signals.product_ids`, pas IA) selon les associations. Battle cards par couple
  `(product, competitor)`. Limite de products par tier (`PRODUCT_LIMIT_*`).
  Mono-product = transparent (selector caché).
- **Le lien EST l'appartenance (2026-07-29)** — `product_competitors.is_specific`
  distinguait un concurrent « partagé » d'un « spécifique », mais AUCUN chemin
  d'écriture ne le mettait à `true` : `associateCompetitorWithScopedProduct` posait
  `false` en dur, donc tout concurrent créé s'affichait « Shared » même lié à un
  seul produit. Pire, la seule UI d'attribution (`ProductChips`, scope All products)
  ne rendait un chip que pour les liens `is_specific` — donc jamais. Le flag est
  droppé (migration 0053) : la question « ce concurrent, c'est pour quel produit »
  est répondue par les LIGNES de la junction. Les chips listent maintenant les
  produits liés, et sont vides pour un concurrent lié à TOUS les produits (une
  attribution qui ne varie jamais ne désambiguïse rien). Conséquence sur l'ancrage :
  pour qu'un SKU non-primaire parle au nom d'un concurrent, on le DÉLIE du primaire —
  il n'y a plus de flag pour l'exprimer sans changer l'appartenance. Corrigé dans la
  foulée : `resolveProduct` (battle cards) tombait sur le produit PRIMAIRE quand le
  web n'envoyait pas de `productId` (scope All products), donc une carte comparait le
  mauvais produit ; il résout désormais le produit depuis `product_competitors`, même
  priorité d'ancrage que `generate-signal`.
- **Pool de providers IA légaux (patch-22)** — remplace le pool multi-comptes Groq (violait
  les ToS). `complete()` reste l'entrée unique ; pour `provider="groq"` route via `callLLM`
  vers un pool OpenAI-compatible (Cerebras free prio1, Groq prio2, Hyperbolic payant prio3),
  essayés free→payant. `pickProvider` (skip épuisés/breaker, round-robin), quota tokens/jour
  + circuit breaker par provider ET global en Redis (partagé entre runs) ; failover en-appel
  sur 429/5xx. Sans Upstash : « 1er provider, pas de tracking ». Claude = fallback
  `provider="claude"` (swap 1 ligne). Breaker ouvert → banner ai-status, scrapes continuent.
  Rate limit intelligent (staleness) + dur (10/h/user). `ai-capacity-check` alerte ops 80/90%.
- **Collection doctrine — arrêt sur refus explicite (2026-07-14)** : corrige patch-20.
  Cascade réduite à 3 niveaux — L0 fetch, L1 render navigateur (sans proxy), L2 render
  via egress datacenter (choisi EN AMONT sur le monitor `egressTier`, jamais en réaction
  à un blocage). Tout refus du site (403/503/challenge/soft_block/robots Disallow) =
  `markedUnscrapable` immédiat, ZÉRO escalade, ZÉRO retry. robots.txt respecté avant
  toute requête, UA OutrivalBot identifiable (plus de spoofing d'automatisation),
  rate-limit par domaine. Le tier IP résidentiel et le fallback navigateur
  anti-fingerprint ont été supprimés (contournement caractérisé). Page publique `/bot`.
  Apprentissage `monitor.requiresLevel` (0/1/2) ; re-probe 14j.
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
