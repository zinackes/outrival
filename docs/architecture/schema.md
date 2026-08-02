# Schéma de données — Outrival

> Détail du schéma PostgreSQL (relationnel + analytics) et de la structure R2.
> Index : `docs/architecture.md`.

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
                       reference_volumes (jsonb {unit, qty}[] — migration 0057,
                       Pricing Intelligence P3 : les volumes auxquels ce workspace
                       compare le pricing metered. null = les presets. Réglage
                       READ-SIDE pur : le coût à un volume custom est calculé par la
                       MÊME fonction qui a écrit les price_points stockés, donc
                       l'éditer ne re-scrape jamais rien. Meters canoniques
                       uniquement — un meter que rien ne sait comparer laisserait un
                       réglage que l'écran réaffiche et qu'aucune surface n'honore),
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
                       + salary_period (Hiring Intelligence v2 P3, migration 0063) —
                       'yearly'|'monthly'|'hourly'|'daily', lu dans LA MÊME réponse ATS
                       que les montants (Lever salaryRange.interval, Ashby composant
                       Salary, Recruitee salary.period, WTTJ salary_period), donc zéro
                       requête en plus ; null partout ailleurs. Sans lui « 45–60 » est
                       à la fois un taux horaire de contractor et un salaire annuel, et
                       une bande construite sur les deux n'est pas bruitée mais FAUSSE
                       + description_text, remote_mode, employment_type,
                       facts_mined_at (Hiring Intelligence v2 P1, migration 0059).
                       + country_codes (text[]) et geo_resolution (Hiring
                       Intelligence v2 P2, migration 0060) — la ligne `location`
                       résolue 100% OFFLINE et ZÉRO AI (@outrival/shared/geo).
                       country_codes = tous les ISO-3166-1 alpha-2 nommés (« Paris /
                       London » en fait deux) ; geo_resolution = COMMENT ça a été lu
                       ('country' | 'region' | 'remote' | 'unknown'). Les deux null =
                       le posting est antérieur à P2 et n'est pas passé au rattrapage ;
                       'unknown' = il a été LU et n'a pas résolu, ce qui est un fait
                       différent et affiché comme tel.
                       Le CORPS de la JD était DÉJÀ dans les réponses ATS qu'on
                       fetchait (Greenhouse content=true, Workable details=true,
                       Lever/Ashby/Recruitee/Personio le portent dans le payload
                       de liste) et jeté faute de colonne — zéro requête en plus.
                       Null sur les providers dont la liste ne porte pas de corps
                       (Workday, iCIMS, SmartRecruiters, WTTJ) et sur le fallback
                       LLM/careers ; un corps manquant ne fait JAMAIS échouer un
                       provider. remote_mode déterministe (location + JD, hybrid
                       testé AVANT remote sinon « hybrid — 2 days remote » se lit
                       full-remote) ; null = non résolu, jamais deviné — un
                       « onsite » posé sur du silence fabriquerait un signal RTO.
                       facts_mined_at = tampon « cette JD est passée au miner »,
                       quoi qu'elle ait rendu : sans lui une JD stérile est
                       indistinguable d'une non-minée et repart au modèle à
                       chaque run

posting_facts          id, posting_id (cascade), competitor_id, kind
                       (tech|product_hint|team_size|market|language), value,
                       value_key (clé de corroboration), evidence_snippet
                       (VERBATIM), confidence, recorded_at, signalled_at
                       — Hiring Intelligence v2 P1 (migration 0059). Facts minés
                       des JD des nouvelles postings eng/product/data_ml
                       uniquement, par batches de ~10 JDs/appel, cap ~40 JDs/run
                       (le reste au run suivant), loggé ai_runs `mine_job_facts`.
                       TROIS GARDES CÔTÉ CODE, pas dans le prompt
                       (`@outrival/scrapers/jobs-jd-facts`) : (a) evidence_snippet
                       qui n'est pas une sous-chaîne de la JD ⇒ fact DROPPÉ (un
                       fact sans phrase source n'existe pas) ; (b) pré-filtre de
                       nouveauté EN+FR+DE — pas de « new team » / « from scratch » /
                       « de zéro » / « von Grund auf » dans la JD ⇒ aucun
                       product_hint retenu, sinon « scale our platform » devient
                       une fuite produit ; (c) 5 facts max par posting.
                       signalled_at = ce qui empêche une techno de re-signaler à
                       chaque nouveau posting qui la cite, ET la fenêtre que le
                       fact block du signal joint (même attribution read-time que
                       pricing/hiring, pas de change_id à backfiller)

content_items          id, competitor_id (cascade), source_type
                       ('blog'|'changelog'|'docs'|'roadmap'), external_id, url,
                       title, published_at, first_seen_at, item_type, status,
                       topics/products/personas/competitors_named (text[]),
                       summary, evidence_snippet, confidence, enriched_at
                       (Content Intelligence v2 P1, migration 0064). Ce qu'un
                       concurrent A PUBLIÉ, en LIGNES et plus en diff : changelog
                       et roadmap produisaient un snapshot, un diff et un
                       paragraphe, et rien ne s'accumulait : aucune table pour
                       demander « combien de releases le mois dernier », aucun
                       moyen de distinguer un breaking change d'une retouche de
                       copy, et le `product_hint` du bloc Hiring promettait une
                       corroboration « changelog/docs récents » qui n'avait rien à
                       interroger. Écriture EN PLUS : le chemin snapshot → diff →
                       classify reste le plancher. `external_id` = l'id du
                       PUBLIEUR (guid de feed, id d'entrée de portail), jamais
                       dérivé du titre ni de la date, qu'un éditeur peut changer
                       sans rien publier. Donc unique (competitor,
                       source_type, external_id) et re-lire le même feed n'insère
                       rien. `published_at` null quand la source ne date rien
                       (un portail roadmap annonce un STATUT) : jamais remplacé
                       par l'heure de capture, ce qui ferait de NOTRE calendrier de
                       scrape LEUR cadence de shipping. `item_type` : les 4 types
                       bruyants (breaking/deprecation/security/fix) sont décidés
                       par le passage MOTS-CLÉS EN+FR+DE côté code, donc aucun
                       signal de cette feature ne dépend du jugement d'un modèle ;
                       l'IA ne sépare que feature/improvement, qui n'alertent
                       personne. `enriched_at` = tampon « passé au typeur, quoi
                       qu'il ait rendu » (même discipline que facts_mined_at).
                       `evidence_snippet` substring-checké côté code comme
                       posting_facts, null quand le feed n'a donné aucun corps à
                       citer. topics/products/personas/competitors_named restent
                       vides en P1 (remplis par l'enrichissement blog, P2)

case_studies           id, content_item_id (set null), competitor_id (cascade),
                       url, title, customer_name, customer_industry,
                       customer_industry_label, is_canonical_industry (int),
                       use_case, metrics_claimed text[], confidence, recorded_at
                       (Content Intelligence v2 P3, migration 0067). Les histoires
                       clients qu'un concurrent PUBLIE sur lui-même. Les logos
                       homepage (patch-17) disaient COMBIEN ; une case study dit QUI,
                       dans QUEL marché, pour QUEL résultat — la question qu'une
                       équipe sales pose réellement. Unique (competitor, url) : le
                       même lien re-listé chaque semaine n'insère rien, et c'est ce
                       qui rend la découverte idempotente. `customer_name` null sur
                       une histoire anonymisée (« a leading European bank ») : la
                       ligne compte pour la verticale et n'est JAMAIS un
                       customer_win — pas de nom, pas de win. `customer_industry` =
                       slug canonique (@outrival/shared `industry-catalog`, ~32
                       slugs + alias EN/FR/DE, patron entitlement-catalog) ou label
                       slugifié avec `is_canonical_industry=0` ; SEUL un slug
                       canonique des DEUX côtés peut faire monter le signal en high,
                       un slug free-text n'étant que le mot de cette page-là.
                       `metrics_claimed` VERBATIM, substring-checké côté code
                       (garde posting_facts) : une métrique que la page n'écrit pas
                       est droppée, toute sa valeur venant de ce que le concurrent
                       l'a écrite en public

known_customers        id, competitor_id (cascade), name_normalized, display_name,
                       source ('case_study'|'customers_page'), evidence_url,
                       first_seen_at — Content Intelligence v2 P3 (migration 0067).
                       Le registre qui fait de `customer_win` un fait et non une
                       supposition : unique (competitor, name_normalized), donc un
                       client annoncé sur le blog, puis lié depuis l'index, puis
                       encore listé le trimestre suivant est UN win, à vie. Sans
                       lui, « nouveau client » voudrait dire « absent de la capture
                       de la semaine dernière », et un mur de logos qui tourne, une
                       case study republiée sous une autre URL ou une page paginée
                       ré-annonceraient chacun le même win. Normalisation
                       CONSERVATRICE (lowercase, trim, suffixe légal retiré
                       seulement en fin de nom) : une fusion à tort perd un win en
                       SILENCE, ce que rien ne peut détecter. INSERT-ONLY : une
                       disparition n'écrit jamais rien (décision verrouillée — les
                       murs tournent et paginent, un signal de churn bâti sur
                       l'absence serait faux la plupart du temps)

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

calculator_specs       id, competitor_id (unique), url, spec (jsonb — CalculatorSpec :
                       le sélecteur du contrôle de quantité, celui du total, et le meter
                       canonique que le contrôle déplace), version, heal_count,
                       consecutive_failures, last_validated_at, last_heal_attempt_at —
                       P4 (migration 0058), le cache de « recette » du probe : même cycle
                       que parser_extractors mais appliqué à une INTERACTION. Clé par
                       COMPETITOR, pas par domaine : un calculateur est lié à un plan et
                       à un meter, et une clé par domaine prêterait la recette d'un
                       concurrent à la page d'un autre. Écrit seulement après un run qui
                       a mesuré, donc une spec cachée est toujours une spec qui a marché

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
                    de plaintes, jamais scrapée), pricing_probe (ancre du signal de
                    mouvement du coût MESURÉ sur le calculateur d'un concurrent, P4 —
                    jamais scrapée : elle porte ses propres snapshots pour ne pas polluer
                    la chaîne de dédup par content-hash du monitor pricing),
                    shipping_velocity (ancre du signal de cadence de release,
                    Content Intelligence v2 P1, jamais semée ni scrapée. ANCRE
                    DÉDIÉE et pas `changelog` : la chaîne de snapshots du monitor
                    changelog EST ce contre quoi la capture suivante se diffe,
                    donc y écrire un snapshot de vélocité ferait diffe le
                    prochain scrape contre un document qui n'est pas le
                    changelog), customer_proof (ancre des deux signaux de preuve
                    client — case_study_published et customer_win, Content
                    Intelligence v2 P3 ; jamais semée ni scrapée. ANCRE DÉDIÉE et
                    pas `sitemap`/`blog` : ce sont ces deux chaînes de snapshots
                    que la capture suivante se diffe, et la sévérité y serait
                    aussi jugée sur la mauvaise source), hiring_shift (ancre du signal
                    d'inflexion de vélocité de recrutement par département, jamais
                    scrapée), job_facts (ancre des deux signaux minés des JD —
                    tech_adoption et product_hint, cf. posting_facts ; jamais semée
                    ni scrapée. ANCRE DÉDIÉE et pas hiring_shift : la chaîne de
                    snapshots de hiring_shift porte le hash de dédup du détecteur
                    de vélocité, y intercaler des snapshots de facts ferait
                    ré-émettre chaque inflexion), hiring_footprint (ancre des trois signaux
                    déterministes de P2 — first_role_in_country,
                    new_department_opened, hiring_freeze ; jamais semée ni scrapée.
                    ANCRE DÉDIÉE pour la même raison que job_facts : la chaîne de
                    snapshots de hiring_shift porte le hash de dédup de la vélocité.
                    Dédup contre TOUS les snapshots de l'ancre, pas seulement le
                    dernier — trois kinds partagent la chaîne, donc « le précédent
                    était différent » laisserait un pays se ré-annoncer dès qu'un
                    snapshot de gel s'intercale, et un premier poste en Allemagne
                    n'est premier qu'une fois), hiring_salary (ancre des deux signaux
                    de P3 — salary_band_shift et salary_disclosure_started ; jamais
                    semée ni scrapée. ANCRE DÉDIÉE pour la même raison que job_facts et
                    hiring_footprint : la chaîne de snapshots d'une ancre EST son
                    registre de dédup, et y intercaler une 4e famille de clés ferait
                    ré-émettre les autres. `disclosure:started` ne porte pas de semaine
                    dans sa clé, donc il est dédupé à VIE ; les bandes portent la leur,
                    et c'est le cooldown de 4 semaines qui empêche un mouvement soutenu
                    de re-tirer chaque semaine), hackernews (mention-tracking HN via l'Algolia public,
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
                  — roadmap : portail public de roadmap / feedback du concurrent
                    (user-selectable, pro+, weekly, override d'URL optionnel). Pur L0,
                    ZÉRO IA. Trois adaptateurs, du plus précis au plus large.
                    (1) **Canny** : `window.__data` server-rendered. (2) **ProductBoard** :
                    endpoint `portal.productboard.com/api/portal/all` scopé par le seul
                    header `x-portal-path`. (3) **Générique** : lit N'IMPORTE QUELLE page
                    qui SSR son état en JSON (`<script type=application/json>`, flux RSC
                    `self.__next_f`, `window.__X = {…}`) et y cherche la FORME d'une
                    roadmap, c'est-à-dire un tableau d'objets portant id stable, titre,
                    statut-enum et votes. Couvre Featurebase, Gleap, Productlane et les
                    vendeurs jamais nommés, sans navigateur ni IA.
                    La barre de qualification EST la feature (≥3 entrées, ids uniques,
                    ≤8 statuts distincts, votes ou vocabulaire roadmap) : sous la barre →
                    `no_roadmap_portal`, jamais une extraction devinée, parce qu'un
                    listing inventé se diffe comme une réécriture complète de roadmap.
                    Découverte en 5 rungs (URL vendeur donnée → `{brand}.canny.io` →
                    sous-domaines feedback./roadmap./… → lien nav/footer → la page donnée
                    elle-même). Toute adresse DEVINÉE est confirmée en la LISANT, jamais
                    par un HEAD : Canny répond 200 sur tout sous-domaine, et `feedback.`
                    existe souvent en servant un help center, donc s'y engager arrêtait
                    la recherche avant le vrai portail.
                    Snapshot trié par id stable, votes en BANDE (compte exact en metadata,
                    jamais diffé). `no_roadmap_portal` / `portal_private` / `portal_empty`
                    sont des faits neutres (NO_TARGET_MARKERS → `not_available`) ; un
                    parse raté sur un portail VENDEUR atteint reste un échec bruyant et
                    retryé.
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
                    Nullable = pre-detection), recorded_at,
                    rate_structure, minimum_amount, percentage_rate (Pricing
                    Intelligence P3, migration 0056 — HOW a metered plan charges :
                    standard|graduated|volume|package|percentage · le plancher mensuel
                    (un max(), pas un additif) · le « 2.9% » enfin numérique, `price`
                    portant alors la part FIXE. Tous null sur une ligne subscription,
                    donc sur toute ligne legacy : ils décrivent un plan metered et leur
                    absence n'est pas un fait sur le plan. `rate_structure` sert AUSSI
                    de tampon « le détecteur a tourné sur cette ligne » — sans lui, le
                    diff lirait un minimum null comme « pas de minimum » et annoncerait
                    au 1er scrape post-deploy un plancher présent depuis toujours)
price_tiers         competitor_id, plan_name, unit (meter NORMALISÉ via unit-alias),
                    from_qty, to_qty (null = bande finale non bornée), unit_price,
                    flat_fee, recorded_at — Pricing Intelligence P3 (migration 0056) :
                    les bandes de volume PUBLIÉES par la page, même timestamp de batch
                    que pricing_history du run. Écrites seulement si la page les
                    imprime ; un set invalide (bandes qui se chevauchent, trou, borne
                    inversée, >12 bandes) est droppé EN ENTIER, jamais rogné à son
                    préfixe valide — une échelle à moitié lue calcule un coût faux avec
                    assurance. L'arithmétique tourne sur les PLAFONDS (to_qty), donc
                    « 10k–50k » et « 10 001–50 000 » calculent à l'identique.
                    Diff (diffPriceTiers, shared) → tier_boundary_moved HIGH (la hausse
                    dont aucun nombre imprimé ne bouge) + rate_changed sur l'unit_price
                    d'une bande (table P1 : baisse >15% = critical)
price_points        competitor_id, plan_name, meter_unit (canonique SEULEMENT),
                    reference_qty, effective_monthly_cost, currency, method
                    (computed_from_tiers | calculator_probe (P4) | published),
                    evidence_key + evidence_kind (P4, migration 0058 — la PREUVE d'une
                    ligne mesurée : `screenshot` = la frame d'où le montant a été lu ;
                    `api_response` = la propre requête de pricing de la page rejouée à
                    ce volume (URL + corps + chemin du montant), et seulement après que
                    cet endpoint a répondu au volume ANCRE le montant que le calculateur
                    affichait. Obligatoire sur une ligne calculator_probe, null sur toute
                    ligne calculée/publiée, dont la preuve est le texte de la page),
                    recorded_at — Pricing Intelligence P3 (migration 0056) : ce qu'un
                    plan metered COÛTE à un volume, la ligne qui fait entrer un
                    concurrent usage-based dans une comparaison de prix. Calculé
                    déterministe (costAtVolume, zéro AI) aux 4 volumes preset
                    (1k/10k/100k/1M). Le volume CUSTOM d'un workspace
                    (organizations.reference_volumes) n'est PAS stocké : il est calculé
                    ON READ par la même fonction, donc changer le réglage ne
                    re-scrape rien et le nombre lu ne peut pas contredire le stocké.
                    Aucun point sur un meter non normalisable (unknown ≠ deviné) ; un
                    plan hybride porte la souscription sur laquelle son meter s'appuie,
                    sinon il se lit moins cher qu'il ne facture. method='published' =
                    un exemple chiffré que la page IMPRIME, cru seulement si SES DEUX
                    nombres sont dans le texte (patron substring P2)
plan_entitlements   competitor_id, plan_name, feature_slug (canonique via
                    entitlement-catalog, sinon slugifié is_canonical=0), feature_label
                    (VERBATIM page — la preuve), kind (boolean|config|metered, modèle
                    Stigg), value_num, value_text, unit, reset_period, recorded_at
                    — Pricing Intelligence P2 (migration 0055) : la matrice
                    features × plans du même scrape pricing, recorded_at = LE même
                    timestamp de batch que pricing_history du run. Extraction
                    table-first (parse déterministe du <table> comparatif ancré sur
                    les plans extraits) → AI sœur sinon (1 call/scrape changé) ;
                    substring-check code-side, caps 15×6, anti-collapse. Diff
                    (diffEntitlements, shared) → entitlement_moved high (sens
                    down/upmarket) / entitlement_limit_changed medium|high ±30% /
                    added low / removed medium — JAMAIS critical, slugs canoniques
                    seuls pour appear/disappear/move. Mergé dans le signal
                    déterministe P1 (routePricingSignal). UI : volet Packaging du
                    pricing tab + section battle card déterministe
hiring_salary_bands competitor_id, department_bucket, currency, p25, p50, p75, n,
                    week_start, recorded_at — Hiring Intelligence v2 P3 (migration
                    0063) : ce que paie un concurrent, PAR département et PAR SEMAINE
                    ISO. Même discipline d'upsert que hiring_metrics/hiring_geo (écrit
                    seulement sur run ATS autoritatif — la médiane d'une TRANCHE de
                    board est un autre nombre que la médiane du board, indiscernable
                    en aval d'un vrai mouvement de paie). La CLÉ contient la DEVISE :
                    rien n'est jamais converti (un taux de change est une donnée
                    variable qu'on ne capture pas, donc une « médiane » à cheval sur
                    EUR et USD bougerait quand l'euro bouge et se lirait comme un
                    changement de salaire), donc un concurrent qui recrute à Paris et à
                    New York porte DEUX bandes indépendantes pour le même bucket et
                    l'UI affiche les deux dans leur devise. Les percentiles sont des
                    midpoints ANNUELS : chaque posting compte pour (min+max)/2, yearly
                    ×1 et monthly ×12 ; horaire et journalier sont EXCLUS (annualiser
                    un taux de contractor, c'est inventer un nombre d'heures que
                    l'annonce n'a jamais écrit). `n` = le nombre de postings dont la
                    bande a réellement été calculée, affiché partout où la bande l'est —
                    un p50 sur deux rôles est un nombre, pas un taux de marché.
                    Bucket 'unknown' exclu. Rien ne signale sous n=3
job_counts          competitor_id, department, count, recorded_at
ats_coverage_gaps   platform, host, competitor_id, resolution (api_adapter|json_ld|
                    ai_fallback|none), job_count, occurrences, last_seen_at —
                    Hiring Intelligence v2 P4 (migration 0065) : COMMENT le board
                    jobs de chaque concurrent est réellement lu, c'est-à-dire la
                    boucle d'apprentissage qui décide du prochain adapter ATS.
                    UPSERT par (platform, competitor), pas append-only : la question
                    est l'état COURANT d'un board plus le nombre de fois qu'on l'a
                    rencontré. `occurrences` s'incrémente, `resolution`/`job_count`
                    sont écrasés — un board qui se met à résoudre par le markup
                    quitte la liste des trous le jour même. `platform` vient de la
                    détection PASSIVE (`detectAtsPlatform`, reconnaît sans fetcher :
                    les 9 adapters + teamtailor/join/softgarden/taleez/talentsoft/
                    jobylon/factorial/breezy/bamboohr/pinpoint/homerun), donc un trou
                    est NOMMÉ. Lecture : `pnpm --filter @outrival/workers ats:coverage`
                    (classement par occurrences × job_count — ni le nombre de boards
                    ni le volume d'annonces ne suffit seul)
hiring_metrics      competitor_id, department_bucket, open_count, week_start,
                    recorded_at — hiring-velocity : open-role count PAR bucket
                    canonique (8 buckets + unknown) et PAR semaine ISO. Unique
                    (competitor, bucket, week_start) → UPSERT (un re-scrape la même
                    semaine écrase, jamais de doublon). Écrit seulement sur run ATS
                    autoritatif ; alimente les sparklines Hiring + le détecteur d'inflexion
hiring_geo          competitor_id, country_code, open_count, week_start, recorded_at
                    — Hiring Intelligence v2 P2 (migration 0060) : où sont les postes
                    ouverts, PAR pays et PAR semaine ISO. Même discipline d'upsert que
                    hiring_metrics (unique (competitor, country_code, week_start), écrit
                    seulement sur run ATS autoritatif). `country_code` est un ISO-3166-1
                    alpha-2 SAUF trois clés réservées EN MINUSCULES — `remote`, `region`
                    (EMEA/DACH : une région ne nomme aucun pays) et `unresolved` — qui
                    comptent les postings que le résolveur n'a pas placés. Elles vivent
                    dans la table plutôt que d'être jetées parce que la PART d'un board
                    qu'on ne sait pas placer est le chiffre qui dit si le reste de la
                    carte est croyable ; un graphe qui les omet en silence revendique une
                    précision qu'il n'a pas. Minuscule vs majuscule ⇒ zéro collision, et
                    first_role_in_country ne lit que les clés majuscules. Un posting qui
                    nomme 2 pays compte dans LES DEUX (la question est « recrutent-ils
                    en X », pas comment les postes se répartissent) : les lignes ne sont
                    donc PAS une partition et ne se somment pas
review_scores       competitor_id, source, score, review_count, sentiment_score,
                    sub_ease_of_use, sub_support, sub_features, sub_value (Nullable —
                    patch-32 sous-notes /5), recorded_at
signal_feed         org_id, competitor_id, category, severity, recorded_at
scrape_runs         monitor_id, competitor_id, source_type, status (success|no_change|
                    failed), level (0-4 cascade — patch-20), attempts, failure_reason,
                    duration_ms, recorded_at  — ops (patch-02/20)
ai_runs             task (classify|classify_structured|narrate_change|insight|digest|
                    battle_card|extract_pricing|extract_jobs|extract_reviews|
                    extract_self_profile|generate_extractor|mine_job_facts|type_content_items|extract_case_studies|source_summary|
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
calculator_probe_runs  competitor_id, url, strategy (ui|endpoint|endpoint_replay|none),
                    anchor_screenshot_key (la frame du calculateur piloté — preuve au
                    niveau du RUN, donc un run rejoué montre toujours la session
                    réellement ouverte), outcome
                    (measured | a ProbeFailure: robots_disallowed/refused/login_wall/
                    no_controls/unit_unresolved/no_total/total_not_monthly/
                    volumes_out_of_range/spec_stale/timeout | a rejection:
                    non_monotonic/reread_mismatch/currency_mismatch/…), detail,
                    meter_unit, readings, points_written, healed, duration_ms,
                    recorded_at — P4, the learning loop for a measurement that is
                    ALLOWED to fail silently. Without it, "we measure calculator
                    pricing" is indistinguishable from "we never manage to", since a
                    refused probe writes no points by design
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
battle-cards/streams/{competitor_id}/{product_id|default}.json
                                  (éphémère — la carte EN COURS d'écriture : la passe
                                   de vérification streame et le worker y pousse le
                                   texte parsé toutes les ~200 ms. Écrasé à chaque
                                   run, supprimé quand la ligne battle_cards atterrit ;
                                   l'API l'ignore au-delà de 10 min, donc un run mort
                                   laisse un objet inerte, jamais un fantôme)
diffs/{change_id}/before.png      (futur — Phase 8+)
diffs/{change_id}/after.png       (futur — Phase 8+)
```

