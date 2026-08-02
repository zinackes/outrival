# Décisions architecturales — Outrival

> Le "pourquoi" derrière les choix structurants, du plus récent au plus ancien.
> Index : `docs/architecture.md`.

## Décisions architecturales clés

- **Le prix d'un calculateur se MESURE, il ne se lit pas (P4, 2026-07-31)** — une
  page `dynamic` ne publie aucune liste : son prix n'existe que comme la RÉPONSE
  de son calculateur à un volume. Tout l'étage d'extraction (structured → cache →
  heal → IA) n'a donc rien à extraire, et ces concurrents entraient dans une
  comparaison de prix en « No pricing captured ». Le probe utilise le calculateur
  comme un prospect : il bouge le contrôle de quantité, attend, lit le total,
  screenshote l'écran exact d'où le nombre vient. Trois règles portent la
  crédibilité du chiffre. (1) **Zéro point sur échec** : monotonie, devise unique,
  bornes, et surtout DOUBLE LECTURE (re-régler la même quantité doit redonner le
  même total) — un seul check en échec droppe le run ENTIER, parce qu'une série
  à moitié crue calcule une courbe de coût fausse avec assurance. (2) **Preuve
  obligatoire par point** : un point dont le screenshot n'a pas pu être stocké
  fait tomber le run ; « mesuré » sans écran à montrer n'est qu'une affirmation.
  (3) **L'IA ne lit jamais un prix** : le heal ne nomme que des SÉLECTEURS, une
  fois, caché ensuite (`calculator_specs`) — les valeurs restent 100%
  déterministes. Le signal qui en découle est plafonné à `high` : `critical`
  bypasse toute la modération et envoie un email en minutes, et une lecture d'UI
  n'a pas cette certitude-là (la confirmation double-capture est du ressort du
  bloc Véracité).
- **L'endpoint du calculateur se rejoue, mais seulement après confirmation (P4)** —
  quand la page calcule côté serveur, le JSON de son propre XHR est une meilleure
  source que le DOM (pas de formatage, pas de compteur animé attrapé en cours de
  tween). Et comme la flotte compte 38 concurrents `dynamic` (mesuré sur prod le
  2026-07-31, sur 172), garder un Chromium ouvert pour quatre volumes coûte
  ~10-15 min de navigateur par jour sur le worker qui scrape déjà tout le reste.
  Le probe pilote donc le PREMIER volume dans le navigateur (screenshot compris),
  puis demande les suivants à cet endpoint en HTTP, navigateur fermé. Quatre
  garde-fous font que ce n'est pas « forger des requêtes sur une API privée » :
  (1) la requête n'est pas inventée, c'est celle que la PAGE a émise pendant qu'on
  bougeait son curseur, avec un seul nombre changé ; (2) GET même-origine dont la
  quantité est dans la query — un POST, un payload signé ou un autre host n'est pas
  quelque chose qu'on a compris assez pour le répéter ; (3) aucun credential créé,
  et une requête portant un en-tête Authorization est refusée plutôt que re-signée ;
  (4) le plan est CONFIRMÉ avant d'être cru — l'endpoint doit répondre au volume
  ancre le montant que le calculateur venait d'afficher, sinon le run finit dans
  l'UI. Cette confirmation sert aussi de double lecture (deux transports
  indépendants), et chaque point rejoué garde requête+réponse comme preuve, à côté
  du screenshot de l'ancre.

- **Un 429 se répond en changeant de provider, pas en dormant (2026-07-31)** — le
  SDK OpenAI honore le `retry-after` d'un rate limit en DORMANT sur le même
  provider, et les tiers gratuits répondent jusqu'à une minute (Groq : « try again
  in 17.8s » sur 8000 TPM ; Cerebras ~60s). Vu de `callLLM` l'appel est juste lent,
  donc le failover du pool — la raison d'être d'avoir plusieurs providers — ne se
  déclenchait jamais. Mesuré sur prod : TOUT gate de fidélité qui en croisait un
  revenait à 57-60s quel que soit son nombre d'appels au juge (3×19s, 2×29s, 6×10s),
  contre ~0,5s par appel sans throttle — et l'utilisateur regardait cette minute
  sous l'étiquette « Checking it against the evidence » de sa battle card. Les
  retries SDK ne s'appliquent donc plus qu'au DERNIER provider non essayé, le seul
  cas où attendre est la seule option restante ; partout ailleurs un 429 bascule
  immédiatement. Conséquence assumée : quand TOUS les providers sont throttlés,
  l'appelant reçoit une erreur au lieu d'un succès à 60s — ce que les chemins
  dégradent déjà (le gate fail-open publie, les jobs pg-boss réessaient).
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
  claim infidèle, la sortie ne part pas — pas d'email, pas de Slack — et atterrit
  dans la review queue EXISTANTE (`ai_quality_checks`,
  colonne `faithfulness`) **avec les phrases fautives nommées**. Le blocage vise la
  frontière SORTANTE, jamais la génération : le signal est inséré (l'idempotence
  par `changeId` est porteuse) et reste lisible in-app, seul l'envoi est retenu.
  Les battle cards, elles, tentent d'abord UN repair (claims refusées nommées à
  `reviseBattleCard`, sortie re-vérifiée, cf. pipeline) : une phrase refusée sur
  vingt coûtait la carte entière, et l'utilisateur n'avait que le re-roll de la
  MÊME évidence comme recours. Ce qui est publié reste ce qui a passé le gate.
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
  vers un pool OpenAI-compatible (Cerebras prio1, Cloudflare Workers AI prio2, Groq prio3,
  Mistral prio4 — tous free), essayés free→payant. `pickProvider` (skip épuisés/breaker, round-robin), quota tokens/jour
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
  retry pg-boss, pas de row orpheline.
- **Idempotence Signal** : check `signals.changeId` (unique) dans BOTH `classify-change`
  ET `generate-signal` (protège des races).
- **SSE DB-backed** plutôt qu'Upstash pub/sub : latence 3s ok pour veille, gratuit, scale VPS.
- **Discovery synchrone** (Phase 4) : appels <15s, pas de job asynchrone (gratuit + simple).
- **Subpath exports** `@outrival/scrapers/{discovery,quick-fetch}` pour ne pas
  pull crawlee/playwright dans l'API.

