# Pipeline data — Outrival

> Provisioning des monitors + pipeline de bout en bout (scrape → diff → classify → signal → dispatch).
> Index : `docs/architecture.md`.

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
                  (ÉCHELLE DE RÉSOLUTION EXCLUSIVE (Hiring Intelligence v2 P4) : adapter API
                   connu → parseur JSON-LD générique → plancher AI. Jamais deux voies sur le
                   même board, jamais de double ingestion. Le rung générique
                   (`@outrival/scrapers` jobs/jsonld.ts) lit le `JobPosting` schema.org que
                   presque tout ATS émet pour Google Jobs, et couvre d'un coup Teamtailor,
                   JOIN, Softgarden, Taleez, Jobylon et la longue traîne des career sites
                   maison. Bonus structurel : le JSON-LD porte description + baseSalary +
                   addressCountry, donc P1 (mining), P2 (géo) et P3 (bandes de salaire)
                   s'allument sur ces boards sans code en plus. Deux formes, dans cet ordre :
                   (a) la page porte ses annonces → zéro fetch en plus ; (b) elle liste des
                   pages job du MÊME host → seules les NOUVELLES sont ouvertes (dédup par URL
                   canonique contre `job_postings`, via `ScrapeOptions.knownJobs`), une à une
                   par `scrapePage` donc robots.txt + Crawl-delay + gap par domaine honorés,
                   cap 30/run — le reste au run suivant, elles sont neuves donc leur absence
                   n'est jamais lue comme une fermeture.
                   CYCLE DE VIE : sur ce rung, ce qui rend un rôle OUVERT c'est d'être SUR LA
                   LISTING, pas d'avoir eu sa page ouverte. Une listing non terminée
                   (pagination au-delà de 5 pages, page en échec) rend donc `null` et non un
                   préfixe — même doctrine que le `truncated` de fetchAtsJobs : un préfixe de
                   board ferme tout ce qui dépasse. La pagination n'est suivie que par les
                   liens que la page REND (`rel=next`, `?page=`), jamais devinée. Une annonce
                   déjà connue est reportée avec son titre et son département VERBATIM, parce
                   que computeJobsDelta clé sur ce couple et qu'une re-dérivation depuis la
                   carte de listing re-clé la moitié du board.
                   Teamtailor = entrée PROVIDERS SANS `api` (leur JSON est token-gated) : le
                   board se résout en sautant sur la listing hébergée `{slug}.teamtailor.com`
                   — qui 301 vers le domaine vanity du client — et en lisant le markup des
                   pages job. Chaque run écrit sa voie dans `ats_coverage_gaps`.
                   structured-first = ATS API JSON island puis JobPosting JSON-LD ; pipeline complet.
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
                   premier poll : coût nul là où c'est inutile.
                   EXPANSION « SHOW MORE » (`SCRAPE_EXPAND_*`) : une liste stabilisée
                   n'est encore que sa PREMIÈRE page quand le board pagine côté client.
                   Workable rend 10 lignes sous un en-tête qui annonce « 56 jobs », donc
                   la capture était une tranche indiscernable d'une liste complète et
                   tout ce qui suivait était extrait comme non-ouvert (mesuré sur
                   careers.exotec.com : 10 postings stockés pour 56 postes ouverts).
                   Les rendus jobs cliquent donc le contrôle « Show more » / « Voir plus »
                   de la liste tant qu'il AJOUTE des lignes. C'est la croissance du DOM
                   qui valide chaque clic : un « Show more » de description se replie en
                   « Show less » au premier, un filtre qui dit « More » n'ajoute rien et
                   arrête la boucle. Les ancres qui navigueraient ne sont jamais cliquées
                   (partir perdrait la capture). La pagination NUMÉROTÉE (« Next », « 2 »)
                   est hors périmètre : elle REMPLACE les lignes, donc la suivre sans
                   logique de fusion capturerait la DERNIÈRE page — pire que la tranche
                   actuelle. Bornée en clics ET en wall-clock)
                  (hiring-velocity : sur un run ATS AUTORITATIF, extract-jobs bucketise
                   les offres en 8 départements canoniques — normalizeDepartment pur,
                   map déterministe + fallback titre, unknown compté — et UPSERT
                   hiring_metrics (competitor, bucket, semaine ISO) ; job_counts brut
                   inchangé. Puis trigger detect-hiring-velocity-shifts, event-driven)
                  (JD mining P1 : les postings insérées QUI PORTENT UN CORPS
                   déclenchent mine-job-facts, event-driven aussi. Jamais sur
                   backfill — backfill-history ne rejoue que homepage/pricing)
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

[on-demand] probe-pricing-calculator (P4 — event-triggered depuis scrape-monitor
  quand une capture pricing LIVE est `dynamic` ET porte des inputs de calculateur ;
  jamais sur backfill, jamais sur le self, dédup pg-boss singletonSeconds 24h)
  └─ collection doctrine : robots.txt AVANT la 1re requête, UA OutrivalBot, rythme
       humain entre interactions, ~15 interactions max, budget 90s. Bannière de
       consentement = clic sur SON bouton visible. Captcha / login / paywall /
       non-2xx = ABANDON silencieux (loggé, jamais contourné)
  └─ contrôle : heuristiques déterministes (label résolu par unit-alias — un meter
       non canonique ⇒ skip complet, unknown ≠ deviné) → spec cachée par competitor
       (calculator_specs) → AI-heal UNE fois (génère des SÉLECTEURS, jamais une
       valeur ; cooldown CALCULATOR_HEAL_COOLDOWN_HOURS) → re-probe
  └─ total : localisé en diffant le DOM avant/après un mouvement de contrôle —
       l'élément dont le MONTANT change EST le total, ce qui prouve du même coup que
       le contrôle pilote la page. Un total libellé à l'ANNÉE est refusé (jamais un
       ÷12 que la page n'affiche pas). Parsing par les helpers money/period existants
  └─ lecture : DOM, ou la réponse JSON du propre endpoint de pricing de la page quand
       un XHR observé porte le montant affiché (strategy=endpoint) — même interaction,
       même preuve, un nombre insensible au formatage
  └─ REPLAY (strategy=endpoint_replay) : le 1er volume est TOUJOURS piloté et
       screenshoté au navigateur ; si la requête de pricing de la page est un GET
       même-origine portant la quantité, et qu'elle répond au volume ANCRE le montant
       que le calculateur affichait, les volumes restants sont demandés à cet endpoint
       en HTTP, navigateur FERMÉ (gap par domaine + rythme humain honorés). Rien n'est
       forgé : c'est la requête que la PAGE a faite, avec un seul nombre changé. POST,
       autre origine, quantité absente de la query ou en-tête Authorization ⇒ refus, on
       finit dans l'UI. Cette confirmation EST la double lecture du run (deux transports
       indépendants), et chaque point rejoué stocke requête+réponse comme preuve.
       Motivation mesurée (2026-07-31) : 38 concurrents `dynamic` sur 172 en prod, soit
       ~36 probes/jour en série sur le worker browser qui scrape déjà tout le reste
  └─ sanity checks CÔTÉ CODE (validateProbeSeries, @outrival/shared) : monotonie
       (égalité tolérée en zone plate/minimum), devise unique, bornes plausibles,
       DOUBLE LECTURE (re-régler la même quantité doit redonner le même total ±0,5%).
       UN check en échec ⇒ le run ENTIER est droppé (0 point) + raison loggée
  └─ preuve : 1 screenshot clippé (contrôle + total) par point, R2
       `calculator-probes/{competitorId}/{ISO}/{qty}.png`, uploadé AVANT la DB. Un
       point sans preuve fait tomber le run
  └─ écriture : price_points(method='calculator_probe', evidence_screenshot_key) aux
       volumes preset + volumes custom du workspace. Au (unit, qty) égal, le MESURÉ
       prime sur le calculé dans cheapestCostAtVolume (le calculé est notre
       arithmétique sur ce que la page imprime ; le mesuré est la réponse de leur
       propre calculateur, frais et planchers inclus)
  └─ signal : delta probe-à-probe à quantité ÉGALE ≥5% → rate_changed medium, ≥15% →
       high, JAMAIS critical (une mesure d'UI n'ouvre pas le canal qui bypasse la
       modération). Chaîne d'ancre synthétique pricing_probe → snapshot → change →
       generate-signal, human_change_before/_after = les coûts mesurés exacts
  └─ chaque tentative est écrite dans calculator_probe_runs (mesurée ou refusée)

[par capture changelog / roadmap] ingest-content-items
  └─ Content Intelligence v2 P1. Event-driven off scrape-monitor (pas de cron),
       skip self pour les SIGNAUX (les lignes sont écrites quand même : la cadence
       compare le produit du user au roster), skip deleted, skip origin=archive
       (aucun signal ne sort d'un backfill)
  └─ INGESTION, ZÉRO IA : les deux sources synthétisent déjà leur snapshot depuis
       de la donnée structurée (feed RSS/Atom, payload de portail), donc chaque
       scraper écrit cette structure dans un ÎLOT JSON à côté du corps diffé et le
       job re-lit ce que le scraper SAVAIT DÉJÀ, au lieu de re-parser de la prose
       depuis le listing qu'il a rendu. L'îlot est un `<script>`, que
       `extractContent` retire AVANT de hasher, donc il ne peut pas déplacer un
       content hash ni fabriquer un change. Constructeur ET lecteur du format
       vivent dans le MÊME module (`@outrival/scrapers/content`) : séparés, un
       champ renommé dériverait en silence et l'ingestion deviendrait muette.
       Changelog → onConflictDoNothing (`returning()` nomme exactement les entrées
       jamais vues, et c'est ce set qui peut signaler) ; roadmap → upsert du
       statut (planned → shipped EST la raison de surveiller un portail)
  └─ TYPAGE (changelog) : mots-clés d'abord (EN+FR+DE, précédence
       breaking > deprecation > security > fix, car une note qui « corrige un breaking
       change sur un endpoint déprécié » est d'abord une rupture), puis batches de
       10 vers le modèle, cap 40/run, loggé ai_runs `type_content_items`. Le modèle
       ne PEUT PAS répondre breaking/deprecation/security : son énumération est
       feature|improvement|fix. Donc aucune alerte de cette feature ne dépend de
       son jugement, et un snippet non-substring est droppé (garde posting_facts)
  └─ signal `breaking_change` / `deprecation`, DÉTERMINISTE. Prend le change du
       changelog LUI-MÊME (scrape-monitor DÉFÈRE le classify pour ça : signals.
       changeId est unique, enqueuer classify en parallèle ferait perdre l'un des
       deux en silence) ; sans émission déterministe le change repart au
       classifieur lexical, exactement le comportement d'avant. high si le
       workspace surveille des docs développeur quelque part, sinon medium.
       Entrées de plus de 90 j ignorées (un feed peut backfiller son archive) et
       une capture SANS change row (la toute première, où toute l'archive arrive
       d'un coup) n'émet rien
  └─ signal `shipping_velocity_shift` : releases/mois vs les 3 mois glissants du
       concurrent, ancre synthétique `shipping_velocity`. Mois TERMINÉS seulement,
       jamais de mois antérieur à l'entrée la plus ancienne détenue, une seule
       émission par épisode (mois qui CROISE). Medium, jamais critical
  └─ fact blocks : le signal nomme les entrées exactes (titre + date + lien +
       type) via `buildSignalFacts`. `changelog` joint la fenêtre d'attribution,
       `shipping_velocity` lit le rawDiff du change (les nombres affichés sont ceux
       que le détecteur a décidés, pas un recalcul sur un feed qui a bougé depuis)

[par capture sitemap · par post blog typé case_study] ingest-case-studies
  └─ Content Intelligence v2 P3. Event-driven (pas de cron) : la branche sitemap de
       scrape-monitor enqueue à CHAQUE capture (les URLs clients neuves partent en
       payload, et le job re-lit l'index — un logo ajouté à une page existante ne
       déplace aucune URL, donc attendre une URL neuve raterait la façon la plus
       courante dont un win devient public), et ingest-blog-posts enqueue les posts
       que l'enrichissement P2 vient de lire comme des case studies. Jamais sur
       backfill, jamais de signal sur le self
  └─ LA PREMIÈRE PASSE EST UNE BASELINE (planCustomersRun, testé) : une page
       /customers liste TOUS les clients qu'une boîte a jamais eus, donc la lire pour
       la 1re fois annoncerait quinze « wins » le jour où on ajoute un concurrent,
       tous vieux de plusieurs années. Les lignes ET le registre sont écrits — c'est
       toute la mémoire que la feature existe pour bâtir — et rien ne signale. Le
       compteur porte sur les DEUX tables : un concurrent dont toutes les histoires
       sont anonymisées garderait un registre vide, donc compter le seul registre
       rendrait chaque run « le premier » et la feature muette à vie
  └─ index clients : probe court des paths (/customers, /case-studies, /clients,
       /kunden, /clientes…) UNE fois, adresse mise en cache sur competitors.metadata
       (`customersUrl`, merge jsonb SQL) — un MISS est caché lui aussi, sinon un
       concurrent sans page clients repaierait le probe chaque semaine. Une page ne
       compte que si elle SE NOMME (title/h1) ET porte des logos ou des liens
       (`looksLikeCustomersIndex`) : un site qui sert sa home sur tout path inconnu
       répond 200 avec un mur de logos, c'est-à-dire exactement ce qu'on cherche
  └─ deux lectures de l'index : logos via `<img alt>` seul (classifyLogoName +
       normalizeCustomerName — un alt qui est un chemin CDN n'est pas une marque, et
       un logo sans nom n'est pas un win) → upsert known_customers ; liens de stories
       même-host → file de lecture (cap 10 pages/run, index compris ; le reste au run
       suivant, loggé — jamais tronqué en silence)
  └─ extraction : batches de 5 (les case studies sont longues), AI_CONFIG.classification,
       loggé ai_runs `extract_case_studies`, nouvelles pages uniquement. Le modèle
       PROPOSE, `applyCaseStudyGuards` DÉCIDE : le nom du client et chaque métrique
       doivent être dans le texte de la page. Le match du nom est SENSIBLE À LA CASSE,
       et c'est toute la garde — une histoire anonymisée écrit « a leading European
       bank » et un modèle rend « European Bank », que la recherche insensible à la
       casse trouve puisque les mots y sont vraiment
  └─ signal `case_study_published` : HIGH seulement si le marché du user résout en
       slug CANONIQUE, celui de l'histoire aussi, et qu'ils sont égaux — sinon MEDIUM.
       Le marché du user vient du selfProfile des products (audience AVANT category :
       la question est à qui ils VENDENT), null = high impossible, jamais approximé
  └─ signal `customer_win` MEDIUM, catégorie `partnerships` (l'existante la plus
       proche — l'enum n'est pas étendu) : les noms de la page clients jamais vus,
       UN signal groupé par run (« 3 new customers — Acme, Globex, Initech »), jamais
       un par nom. Un client vu d'abord dans une case study entre au registre mais
       n'émet PAS de win : le signal de case study le nomme déjà et porte le marché
       et les chiffres. Une disparition n'émet RIEN, jamais
  └─ ancre synthétique `customer_proof` → change (snapshotAfterId = la capture qui a
       déclenché, même forme que competitor_named_you) → generate-signal avec une
       classification SYNTHÉTISÉE. Fact blocks : la story (client, marché, métriques
       verbatim, lien) ou les clients neufs (nom + date de 1re observation), lus sur
       le rawDiff du change et jamais sur une fenêtre — les deux signaux portent sur
       un ensemble NOMMÉ par l'émetteur
  └─ battle card : section « Their customers » 100% déterministe (patron Packaging) —
       GET /api/competitors/:id/customers (verticales canoniques seules, wins < 90 j,
       marquee = les plus anciens) rendue côté web sans modèle ; les mêmes faits sont
       AUSSI injectés dans l'évidence groundée de battle-card.ts, avec leurs n

[par competitor dont un scrape jobs a inséré des postings AVEC corps] mine-job-facts
  └─ skip self / deleted (un « ils adoptent Kubernetes » sur son propre produit est du bruit)
  └─ sélectionne les postings NON MINÉES (facts_mined_at null) des buckets
       engineering/product/data_ml, cap 40/run → batches de 10 → 1 appel IA par batch
       (loggedAi `mine_job_facts`) ; le modèle PROPOSE, les 3 gardes déterministes de
       `@outrival/scrapers/jobs-jd-facts` DÉCIDENT (substring-check du snippet, pré-filtre
       de nouveauté pour product_hint, cap 5 facts/posting)
  └─ insert posting_facts (onConflictDoNothing) + stamp facts_mined_at sur TOUTES les
       postings envoyées, y compris celles qui n'ont rien rendu
  └─ signal `tech_adoption` — DÉTERMINISTE, zéro IA dans la décision : une même valeur
       'tech' sur ≥2 postings DISTINCTES et jamais encore signalée → 1 change groupé →
       generate-signal avec une classification SYNTHÉTISÉE (product/medium). Tire une
       seule fois par techno : la garde est « aucun fact de cette valeur n'a de
       signalled_at », pas un compteur, donc les 3e et 4e postings ne ré-annoncent rien
  └─ signal `product_hint` — medium en occurrence simple ; promu **high** UNIQUEMENT si
       corroboré (2e posting portant la même valeur, OU un change subdomains/docs/changelog
       de moins de 30j sur le même concurrent). JAMAIS critical, et jamais promu sur la
       PREMIÈRE capture jobs d'un concurrent (tout y est neuf par construction, donc
       « deux postings » n'y prouve rien)
  └─ anchor synthétique `job_facts` (monitor isActive=false) → R2 avant DB → snapshot →
       change → generate-signal ; dédup par content-hash préfixé du kind, donc les chaînes
       tech et hint ne se dédupent pas l'une l'autre et un run retenté ne double pas un signal

[par competitor dont un scrape jobs AUTORITATIF vient d'écrire la semaine] detect-hiring-footprint
  └─ Hiring Intelligence v2 P2. Event-driven off extract-jobs (pas de cron), skip self /
       deleted. ZÉRO AI dans la décision : trois détecteurs purs
       (@outrival/scrapers/jobs-hiring `footprint.ts`) sur des comptes
  └─ En amont, dans extract-jobs : la `location` de chaque posting est résolue OFFLINE
       (@outrival/shared/geo — dataset GeoNames construit et COMMITTÉ, zéro dépendance
       runtime, zéro réseau, cas non résolu = 'unknown' JAMAIS deviné) puis le board actif
       entier est agrégé en hiring_geo pour la semaine ISO (même condition « run ATS
       autoritatif » que hiring_metrics). Les postings actives antérieures à P2 sont
       stampées au passage, donc la feature se remplit en un cycle de scrape même sans le
       rattrapage. Tally resolved/region/remote/unknown loggé ET persisté (clés réservées)
  └─ `first_role_in_country` HIGH : un pays présent cette semaine et dans AUCUNE semaine
       antérieure de hiring_geo. Baseline ≥2 semaines — sinon l'onboarding d'un concurrent
       annoncerait un « premier poste » dans les six pays où il recrute depuis toujours
  └─ `new_department_opened` HIGH : un bucket canonique (unknown exclu) présent cette
       semaine et dans aucune semaine antérieure de hiring_metrics. Baseline ≥3 semaines
  └─ `hiring_freeze` HIGH : sur 14 j glissants, fermetures ≥60% du stock ouvert en début de
       fenêtre, stock initial ≥5, ≤1 ouverture. Trois gardes anti-panne : fermetures
       CONFIRMÉES par une capture ultérieure du même board, hôte du board inchangé sur la
       fenêtre, et un seul signal par épisode (ré-armé par ≥2 nouvelles ouvertures). La
       fermeture elle-même n'est possible que sur un run AUTORITATIF (computeJobsDelta) :
       un fetch échoué ou dégradé ne ferme jamais rien
  └─ anchor synthétique `hiring_footprint` → R2 avant DB → snapshot → change →
       generate-signal (classification SYNTHÉTISÉE, category=hiring, severity forcée high)

[par competitor dont un scrape jobs AUTORITATIF publie de la paie] detect-salary-shifts
  └─ Hiring Intelligence v2 P3. Event-driven off extract-jobs (pas de cron), skip self /
       deleted, et JAMAIS enqueué quand aucune offre active n'affiche de salaire (rien
       ne peut bouger, la disclosure ne peut pas avoir commencé). ZÉRO AI dans la
       décision : deux détecteurs purs (@outrival/scrapers/jobs-hiring `salary.ts`)
  └─ En amont, dans extract-jobs : le stock ACTIF entier est bandé par (bucket, devise)
       et upserté dans hiring_salary_bands pour la semaine ISO — même condition « run ATS
       autoritatif » que hiring_metrics/hiring_geo. Base annuelle canonique
       (@outrival/shared `salary-normalize`) : yearly ×1, monthly ×12, HORAIRE ET
       JOURNALIER EXCLUS, midpoint (min+max)/2, JAMAIS de conversion de devises, période
       absente inférée annuelle SEULEMENT si la borne BASSE ≥ 20 000 (sinon la posting est
       exclue — unknown ≠ deviné, cohérent avec la géo de P2). Fourchettes poubelle
       (borne ≤ 0, max < min) droppées EN ENTIER, jamais rognées
  └─ `salary_band_shift` MEDIUM : p50 d'un (bucket, devise) à ±15% de la MÉDIANE de ses
       4 semaines trailing, n≥3 des DEUX côtés, ≥2 semaines trailing qualifiantes, même
       devise uniquement. Cooldown 4 semaines par (bucket, devise). Le dernier point de
       la série doit ÊTRE la semaine courante. Fact block : n, les rôles comptés (titre +
       lien + fourchette), les semaines trailing
  └─ `salary_disclosure_started` LOW|MEDIUM (medium si ≥50% du board) : verdict `yes`
       (≥30% ET ≥3 offres salariées) alors qu'AUCUNE offre n'affichait de paie avant, avec
       ≥4 semaines d'historique où le board avait ≥5 postes ouverts. Émis UNE fois (dédup
       à vie par contentHash). Le ré-armement après un retour à 0 prolongé n'est pas
       implémenté en v1 : le re-tirer à tort sur un trou de données coûte plus qu'un signal
       manqué sur un cas quasi inexistant
  └─ anchor synthétique `hiring_salary` → R2 avant DB → snapshot → change →
       generate-signal (classification SYNTHÉTISÉE, category=hiring, severity forcée).
       Plafonné à medium : une bande de paie est une quantité agrégée lue sur une page,
       elle ne mérite pas le canal qui bypasse la modération et envoie un email en minutes

[cron dimanche 20h UTC] detect-new-competitors
  └─ par org onboardée : Exa findSimilar + scoreOverlap (batché)
  └─ dedup URL exacte + hostname normalisé
  └─ si overlap > 65 → insert candidate + notification "new_competitor"

[on-demand] generate-battle-card
  └─ gather context (productProfile, aiSummary, top reviews, recent signals)
  └─ Groq battle card 6 sections → passe de révision (reviseBattleCard)
  └─ La passe de RÉVISION est STREAMÉE (`onPartial` → `CompletionOptions`) : c'est la
       dernière à toucher le contenu, donc ce qui s'écrit à l'écran est ce qui sera
       publié (streamer le brouillon taperait des claims que cette passe va supprimer).
       Le worker parse le JSON tronqué à chaque delta (`parsePartialCard` — une entrée
       n'apparaît qu'ACHEVÉE, la phrase en cours revient à part avec sa section) et
       pousse le résultat dans R2 toutes les ~200 ms. La page lit ce tampon via
       `GET /battle-card/job/:runId` (`partial`, servi seulement tant que le run
       tourne) et remplit les cadres de sections à la place des skeletons. Best-effort
       de bout en bout : R2 muet = skeletons, comportement d'avant exactement.
       Sur le pool gratuit le modèle émet la carte en une rafale de ~150 ms au bout
       d'un appel de ~1,3 s, donc la page ne suppose PAS qu'elle a été regardée : si
       elle a vu moins de 2 frames, elle rejoue l'animation d'écriture paginée comme
       avant (un unique frame juste avant la ligne est un flash, pas une écriture)
  └─ GATE DE FIDÉLITÉ : verifyFaithfulness(carte, battleCardEvidence(input)) —
       la MÊME évidence que la génération et la révision. Sinon upsert content +
       battle_cards.faithfulness
  └─ `blocked` → UNE tentative de REPAIR, jamais une carte jetée : les claims
       refusées sont nommées à reviseBattleCard (même passe, param `flaggedClaims`)
       qui doit SUPPRIMER les entrées qui les portent, puis la sortie est
       RE-VÉRIFIÉE. Verdict `pass` → la carte réparée est publiée et porte le
       rapport de la 2e passe ; la review queue reçoit quand même le rapport
       bloqué (`repaired:true`) car « le juge avait-il raison » survit à la
       réparation. Tout le reste (repair indisponible, carte vide après coupe,
       re-vérification `blocked` OU `skipped` — strict ici, contrairement au
       fail-open général) → AbortTaskRunError, carte existante intacte. Le
       publié est donc TOUJOURS ce qui a passé le gate, jamais ce qu'on croit
       avoir retiré : aucune attribution floue claim→entrée n'est tentée
  └─ Playwright headless → page.pdf({format:"A4"}) → R2

[cron */6h] ops-health-check (patch-02)
  └─ seuils conservateurs sur scrape_runs / ai_runs / signal_feed (gardes
     d'échantillon min anti alert-fatigue) → 1 message OPS_SLACK_WEBHOOK_URL si dégradé
  └─ SLO first-signal (audit 2026-07-10, docs/slos/onboarding-first-signal.md) :
     SLI 28j/7j + coverage 24h loggés à chaque run ; alertes event-based (3 misses
     consécutifs → page, 7j<50% n≥5 → ticket, 28j<70% n≥10 → policy). Piggyback
     ici par héritage du cap de 10 schedules de Trigger ; pg-boss n'a plus ce cap,
     donc ce piggyback peut redevenir un cron à part quand ça vaut le détour

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

