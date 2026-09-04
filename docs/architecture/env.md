# Variables d'environnement — Outrival

> Liste complète + rationale de chaque flag. Voir aussi `.env.example`.
> Index : `docs/architecture.md`.

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
BETTER_AUTH_URL=             # https://api.outrival.app
GOOGLE_CLIENT_ID=            # patch-19 — Google OAuth (callback = BETTER_AUTH_URL/api/auth/callback/google)
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=  # patch-19 — Cloudflare Turnstile (managed, invisible). Empty → backend bypass (dev)
TURNSTILE_SECRET_KEY=
AUTH_RATE_LIMIT_EMAIL=3      # patch-19 — max attempts per email per window (Upstash; empty creds → no-op)
AUTH_RATE_LIMIT_IP=10        # patch-19 — max attempts per IP per window
AUTH_RATE_LIMIT_WINDOW_MIN=15 # patch-19 — window length in minutes
RESEND_AUTH_FROM=            # patch-19 — optionnel, défaut "Outrival <auth@outrival.app>".
                            # Le défaut était sur outrival.io jusqu'au 2026-08-02 : domaine qui
                            # n'est pas le nôtre et absent de Resend, donc un env qui oubliait
                            # la var envoyait depuis un domaine non vérifié et Resend refusait
                            # TOUT, codes de connexion compris. Idem RESEND_FROM (alerts@)
INTERNAL_API_SECRET=         # standing queries — shared secret worker→API (POST /api/internal/ask/run),
                            # 16+ chars, MÊME valeur sur api ET workers. Vide → routes internes 404,
                            # queries sauvées mais jamais réévaluées (dégradation propre)
OAUTH_TOKEN_ENCRYPTION_KEY=  # AES-256-GCM sur les secrets stockés en base : tokens OAuth tiers
                            # (`oauth_connections`, OUT-176) ET secret de signature des webhooks
                            # CRM (`crm_destinations`, code:SEC-08). 32 octets en hex, soit 64
                            # caractères : `openssl rand -hex 32`. MÊME valeur sur api ET workers,
                            # la box workers signe le push sortant. OPTIONNEL — vide →
                            # /api/oauth/*/start répond 500 `oauth_encryption_unconfigured`,
                            # enregistrer un secret CRM répond 500 `secret_encryption_unconfigured`,
                            # et rien n'est jamais écrit en clair. Les lignes `crm_destinations`
                            # antérieures restent en clair jusqu'à
                            # `pnpm --filter @outrival/db db:backfill-crm-secrets`.
                            # Rotation : les lignes existantes deviennent indéchiffrables
                            # (`secret_undecryptable`, préfixe de schéma `v1.`) — il faut purger la
                            # table OAuth et faire reconnecter, ressaisir les secrets CRM ; il n'y a
                            # pas de re-chiffrement.

# Jobs
QUEUE_DATABASE_URL=          # pg-boss queue — DEDICATED always-on Postgres, NEVER Neon (cf. docs/trigger-to-pgboss-migration.md)
WORKER_ROLE=                 # browser | light — which queues a worker process handles
                            # QUEUE_DATABASE_URL is ALSO required on the api service (send-only:
                            # it enqueues, never executes a handler, never owns cron)
SCRAPE_CONCURRENCY=3         # scrape-monitor jobs in flight per browser worker (was 5 on Trigger's
                            # per-run machines; 3 on the shared 8 GB VPS). The slow lane no longer
                            # exists — it was retired with the L3/L4 cascade tiers
SUMMARY_CONCURRENCY=1        # competitor-summary lane (onboarding burst stays on the free AI tier)
SCRAPE_SPREAD_SEC=3000       # R1 — secondes sur lesquelles le cron horaire étale son batch. Il
                            # enfilait TOUS les monitors dus dans un seul insert, donc toute la
                            # flotte tapait le pool IA dans la même minute et faisait sauter les
                            # fenêtres de tokens par minute. 3000 s = 50 min, soit 10 min de marge
                            # avant le `0 * * * *` suivant. Les monitors dus DANS la fenêtre entrent
                            # aussi dans le batch : sans ça un monitor calé sur :50 raterait l'heure
                            # suivante et sa cadence serait divisée par deux. 0 rétablit le batch
                            # unique. Ordre mélangé (Fisher-Yates) pour qu'aucune org ne soit
                            # systématiquement servie en dernier
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
# Pricing timeline backfill (P5) — the pricing half, fired by backfill-history on the
# first pricing capture. CDX index (1 call) → ~1 capture/quarter → deterministic harvest
# first, AI capped for the WHOLE run. Writes pricing_history(origin='archive') and NOTHING
# else: no change, no signal, no summary. Once per competitor; re-run = dev trigger only.
PRICING_BACKFILL_YEARS=3                         # how far back the timeline reaches
PRICING_BACKFILL_MAX_SNAPSHOTS=12                # hard cap on archived pages fetched per competitor
PRICING_BACKFILL_MAX_AI_CALLS=4                  # AI extractions for the whole backfill; past it a capture is skipped, never half-read
PRICING_BACKFILL_GAP_MS=1500                     # courtesy gap between two fetches to web.archive.org
HOMEPAGE_SCROLL_PASSES=2              # patch-16 — progressive scroll passes (homepage only)
HOMEPAGE_LAZY_WAIT_MS=2000            # patch-16 — wait after each scroll pass
HOMEPAGE_NARRATIVE_MIN_SEVERITY=medium  # patch-16 — min severity to spend an AI narrative
HOMEPAGE_SCREENSHOT_ENABLED=true     # capture a homepage screenshot (floors the cascade at L1 = browser render per homepage scrape) → pHash visual-redesign + before/after visual diff. false = cheap L0 fetch, no screenshot
JOBS_RENDER_ENABLED=true             # jobs source only — render the committed careers/board page at L1 + scroll + expand its "Show more" pagination, so client-injected openings (SSR "Loading positions…" placeholders) AND the rows past page 1 both load before extraction. Path probing stays cheap L0; only the kept page + off-site hops pay a render. false = previous L0-only behaviour exactly
SCRAPE_EXPAND_MAX_CLICKS=25          # jobs renders — cap on "Show more" clicks per capture (~250 rows at Workable's 10/page). Each click must GROW the DOM or the loop stops, so this is a runaway guard, not a tuning knob. 0 disables expansion alone
SCRAPE_EXPAND_MAX_MS=30000           # jobs renders — wall-clock cap on the whole expansion, so an infinite-scroll list can never hold a scrape open
PRICING_TOGGLE_CAPTURE_ENABLED=true  # pricing source only — after the primary (default-period) capture, click the Monthly↔Annual toggle and append the other period's prices as a HIDDEN block so the extractor sees both periods (only the default state renders on JS pages). Best-effort + primary-capture-first (never affects the snapshot); the hidden block is stripped by extractContent (change-detection) so a flaky toggle can't fake a pricing change, but survives htmlToText for extraction. Browser levels only. false = default-period only. See docs/pricing-coverage-2026.md
PRICING_RENDER_RETRY_ENABLED=true    # pricing source only — when the L0 (no-browser) capture contains no harvestable price, re-scrape once with a browser render (local L1, no proxy). Catches client-rendered pricing pages that L0 accepts as text-rich marketing shells. false = previous L0-accepting behaviour exactly
PRICING_HARVEST_ENABLED=true         # pricing source only — L2 harvest floor (docs/pricing-coverage-2026.md Part II). When the staged extractor (structured→cache→heal→AI) returns no plans yet the page visibly carries prices, an AI-free DOM harvest recovers the entry price / band / per-card rows the SaaS-tuned AI floor drops on hosting/e-commerce/configurator layouts. Self-gating (no visible price → no-op), 0 AI. false = exactly today's behaviour (empty tiers when the AI floor finds none)
PRICING_AGGREGATE_ENABLED=true       # pricing source only — L3 product-line aggregation (docs/pricing-coverage-2026.md Part II). No /pricing page but ≥2 priced product pages / a store subdomain (hosting/e-commerce catalogs) → the pricing scraper captures the top-K (cap 3) and stitches them into ONE delimited snapshot so each becomes a "<line> · <tier>" row (extract-pricing splits per section, prefixes plan_name). Only fires with no convention pricing page + ≥2 same-registrable-domain commerce links; costs K extra browser scrapes then. false = single-page behaviour
PRICING_CALCULATOR_PROBE_ENABLED=true # pricing source only — Pricing Intelligence P4. A `dynamic` page publishes no list, only a calculator: the probe DRIVES that calculator on the public UI (robots honoured, OutrivalBot UA, human pacing, 1 run/competitor/day via a pg-boss singletonSeconds key, block/login/captcha = silent abandon) and stores what it charged at the reference volumes as price_points(method='calculator_probe'), each row carrying the R2 key of the screenshot it was read off. A failed probe writes ZERO points — never partial, never extrapolated (validateProbeSeries drops the whole run). false = no probe ever runs
PRICING_PROBE_TIMEOUT_MS=90000       # whole-run budget for one probe
PRICING_PROBE_MAX_INTERACTIONS=15    # clicks + value changes per probe (runaway guard, not a tuning knob)
PRICING_PROBE_PACE_MIN_MS=600        # human pacing between interactions, randomised in this band
PRICING_PROBE_PACE_MAX_MS=1600
PRICING_PROBE_SETTLE_MIN_MS=700      # plancher avant qu'un total soit déclaré « stabilisé » : deux lectures égales ne suffisent pas, car juste après un mouvement la page affiche encore l'ANCIEN total (un poller rapide lirait deux fois la réponse précédente). Le recompute debouncé 200-500ms est la norme sur un calculateur
PRICING_PROBE_SETTLE_POLL_MS=250     # intervalle de poll pendant cette attente
PRICING_PROBE_SETTLE_MAX_MS=5000     # cap de l'attente, par interaction
CALCULATOR_HEAL_COOLDOWN_HOURS=72    # min hours between two AI attempts to (re)generate a competitor's calculator spec. The heal names SELECTORS only; every amount is parsed by code, so no price ever passes through a model
ENRICHMENTS_PHASH_THRESHOLD=15          # patch-17 — Hamming distance → visual redesign
ENRICHMENTS_VOLATILE_THRESHOLD=5        # patch-17 — consecutive diffs → line is volatile
ENRICHMENTS_VOLATILE_RESET=10           # patch-17 — stable scrapes → analysable again
ENRICHMENTS_ANTIVOID_THRESHOLD=0.3      # patch-17 — content/median ratio → anti-void
ENRICHMENTS_RELEVANCE_MIN_SCORE=0.5     # patch-17 — min relevance score to emit a signal
SNAPSHOT_COMPLETENESS_ENABLED=true      # reliability wave 1 (R1) — grade a degraded capture `partial`: never the diff baseline, never fed to the extractors, dropped from the anti-void median. false = pre-R1 behaviour. The thresholds themselves are named constants in @outrival/scrapers/completeness (they are calibrated against fixtures, not tuned per environment)
SIGNAL_VERIFICATION_ENABLED=true        # reliability wave 2 (P2) — double-capture before a critical (any source) or a high on pricing/homepage. false = pre-P2 behaviour, every signal emits immediately. Out of the perimeter the check is one indexed lookup; aggregated-data signals and synthetic anchors are exempt by construction (no page was fetched, so `capture_method` is null)
QUICK_CHECK_DELAY_MIN=2                 # reliability wave 2 — minutes before the quick recheck. Kills the transient (half-rendered page, error page served for seconds)
VERIFY_DELAY_MIN=30                     # reliability wave 2 — minutes from DETECTION to the independent capture. The delay IS the independence: CDN TTLs are in minutes and A/B bucketing is usually per IP, so an immediate re-fetch can only agree with the first capture. Retune downward on real signal_verifications data
VERIFY_CONCURRENCY=2                    # reliability wave 2 — parallel verify-signal-delta handlers. Browser worker: a `rendered` original is re-captured with Chromium
TECH_STACK_SCRAPE_INTERVAL_DAYS=30      # patch-18 — days between tech-stack scrapes per competitor
TECH_STACK_SIGNAL_MIN_IMPORTANCE=high   # patch-18 — min tech importance to emit a signal on appearance (high = payments/CRM-class tells only; medium would include hosting/marketing scripts — noisy, plan-026). Baseline (first-ever) scan of a competitor never signals, whatever this value is.
REVIEW_THEME_WINDOW_DAYS=42             # review complaint-theme shift — recent window (days) compared vs baseline for an upward inflection
REVIEW_THEME_LOOKBACK_DAYS=84           # review complaint-theme shift — total review_scores series read (baseline = lookback − window)
REVIEW_SCORE_DROP_THRESHOLD=0.2         # Reviews v2 — aggregate-score inflection fallback for surface sources (Trustpilot public: score, no verbatims/themes). When no complaint theme rises, a sustained drop of the average review score by ≥ this many points (baseline → recent window, same windows as the theme detector) emits one "reviews" signal via the detect-review-theme-shifts anchor
HIRING_SPIKE_THRESHOLD=0.5              # hiring-velocity — a department's weekly open-role count must exceed (1 + this) × its trailing 4-week average (≥4 weeks history) to emit a "hiring" inflection signal; high severity for engineering/sales, medium otherwise. Event-driven off extract-jobs (no cron slot)
HIRING_FREEZE_WINDOW_DAYS=14            # hiring_freeze (P2) — fenêtre glissante sur laquelle les fermetures sont comptées
HIRING_FREEZE_CLOSED_RATIO=0.6          # part du stock ouvert en début de fenêtre qui doit avoir fermé
HIRING_FREEZE_MIN_OPEN=5                # sous ce stock initial, un board vidé n'est pas une nouvelle
HIRING_FREEZE_MAX_OPENED=1              # au-delà de N ouvertures dans la fenêtre ils recrutent encore, quoi qu'il ait fermé. Trois gardes NON réglables s'y ajoutent CÔTÉ CODE : les fermetures doivent avoir été CONFIRMÉES par une capture ULTÉRIEURE du même board (un ATS qui répond 200 avec une liste courte ferme la moitié d'un board en un run — c'est la forme exacte d'un gel, et c'est la seule qui se dément au scrape suivant), le board ne doit pas avoir changé d'hôte dans la fenêtre, et un seul signal est émis par épisode (ré-armé par 2 nouvelles ouvertures, pas par une horloge)
SALARY_BAND_SHIFT_THRESHOLD=0.15        # Hiring Intelligence v2 P3 — relative move of a (bucket, currency) p50 against the median of its trailing 4 weeks that emits a `salary_band_shift` (medium). Signed: a cut signals like a raise
SALARY_BAND_MIN_POSTINGS=3              # postings a band needs on BOTH sides (current week AND each trailing week counted) before it can signal. Under it the band still renders — with its n — it just cannot move the needle
SALARY_BAND_COOLDOWN_WEEKS=4            # weeks a (bucket, currency) stays quiet after firing. A band that steps up and HOLDS is one piece of news: without the cooldown the new level enters the trailing window week by week and the same move re-fires as it does. Two more guards live in code and are not tunable: at least 2 trailing weeks must clear the n floor (a "trailing median" over one week is a week-on-week comparison wearing a baseline's clothes), and the series' last point must BE the current ISO week, so a competitor whose board stopped being scraped can never fire against a baseline that aged out from under it
HN_POINTS_THRESHOLD=50                  # hackernews source — a mention (non-Show-HN, guard-passing) must EXCEED this many points to emit a content/medium traction signal; below it the hit is stored in the snapshot JSON island but never signalled. Show HN + matching domain always signals product/high regardless.
HN_WINDOW_DAYS=30                       # hackernews source — recency window (days) bounding the HN Algolia search_by_date fetch (created_at_i > now − window), so a heavily-mentioned competitor never hits the hard 1000-hit ceiling
DOCS_PAGE_HASH_ENABLED=true             # docs source, mode 2 only (no OpenAPI spec found) — on top of the sitemap page list, fingerprint the top-K docs pages so a REWRITTEN page surfaces, not only a new one. The hash is taken over extractContent output (the exact text the pipeline diffs), so a build id / nonce can never churn it; a page that fails to fetch emits NO line (never a placeholder hash). false → page list only, K fewer L0 GETs per run
DOCS_PAGE_HASH_MAX=20                   # docs source — how many pages get fingerprinted per run. Deterministic pick (shallowest path first, then lexicographic) so the selection can't drift and fake "changed" lines; a brand-new SHALLOW page can displace the Kth, which reads as one stray removed fingerprint line next to the genuine new-page line
SHIPPING_VELOCITY_THRESHOLD=0.5         # Content Intelligence v2 P1, relative move of a competitor's monthly release count against its own trailing 3 months that emits a `shipping_velocity_shift` (medium, category product). Signed: a product freeze signals like an acceleration. THREE guards live in code and are not tunable, because each of them is the difference between a reading and a monthly false alarm. (a) Only months that have ENDED are evaluated: a month three days old compared against three full ones reports a freeze at every competitor on the 3rd, every month. (b) No month at or before the one the OLDEST held entry falls in is ever counted: a feed serves its most recent N entries, so earlier months read as zero when what they really are is unobserved, and counting them would report an acceleration at a competitor that has shipped at a flat rate for years. (c) Fire on the month that CROSSES, not on every month that stays across, the same crossing rule the hiring detector uses, so a sustained ramp is one piece of news and a dip that re-crosses months later is news again
SHIPPING_VELOCITY_MIN_ITEMS=8           # entries the trailing 3-month window must TOTAL before it counts as a baseline. Under it a changelog of three entries would swing ±50% on a single release, which is arithmetic, not cadence

# AI
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
AI_PROVIDER_N_MAX_REQUEST_TOKENS=  # plafond d'UNE requête chez ce provider (≠ quota
                                   # journalier, qui est un budget : celui-ci est un mur).
                                   # Groq gratuit compte prompt + max_tokens contre ses
                                   # 8k tokens/MINUTE et répond 413 au-dessus, donc une
                                   # tâche dont le prompt est structurellement plus gros
                                   # n'y réussira JAMAIS, quel que soit le nombre de
                                   # retries. Mesuré sur 7j de prod : 430 appels de ce
                                   # type, dont 198 `generate_extractor` (~12k tokens de
                                   # HTML élagué) tous refusés, pendant que Cerebras
                                   # servait la même tâche 206 fois. Le pool écarte
                                   # désormais un provider qu'il dépasserait au lieu de
                                   # dépenser l'appel ET le slot de failover pour se
                                   # l'entendre dire — un prompt trop gros ne peut plus
                                   # se lire comme « all_providers_failed ». VIDE = aucun
                                   # plafond connu = comportement d'avant (on tente, le
                                   # provider tranche)
AI_PROVIDER_2_ID=groq              # 1 compte, prio 3. QUOTA=200000 : c'est le TPD gratuit
                                   # PUBLIÉ par Groq (8k tokens/min, 200k/jour). Il valait
                                   # 500000, donc le pool passait la fin de chaque journée à
                                   # découvrir la limite par 429 (231 erreurs sur 401 runs
                                   # Groq le 31/07/2026, pendant que Cerebras en servait
                                   # 740k sans une seule)
AI_PROVIDER_3_ID=cloudflare        # Workers AI, MÊMES poids gpt-oss (120b + 20b), prio 2.
                                   # 10k Neurons/jour gratuits = ~286k tokens/jour à notre
                                   # mix mesuré 91,5% input ; l'account id vit dans BASE_URL
                                   # (le même que R2_ACCOUNT_ID). Débordement payant
                                   # $0.35/$0.75 par M
AI_PROVIDER_4_ID=mistral           # La Plateforme free : 1 Md tokens/mois, 1 req/s, prio 4.
                                   # Plus grosse enveloppe gratuite et seule EU, mais AUTRE
                                   # famille de modèles → dernière priorité tant que
                                   # eval:severity + eval:faithfulness ne sont pas passées.
                                   # Deux gestes manuels : opt-out training (Admin Console >
                                   # Privacy, le tier gratuit entraîne PAR DÉFAUT) et pinner
                                   # un id de modèle DATÉ depuis GET /v1/models, jamais un
                                   # alias `-latest`
# (… _BASE_URL/_API_KEY/_MODEL/_TIER/_DAILY_TOKEN_QUOTA/_PRIORITY par provider, cf .env.example)
# Plus de plancher PAYANT : `AI_PROVIDER_3_ID=hyperbolic` était documenté depuis patch-22
# mais n'a jamais eu de clé en prod et n'a jamais servi une requête (ai_runs ne connaît que
# groq et cerebras du 05/06 au 31/07/2026). Quand les gratuits sont épuisés, l'IA s'arrête.
AI_PROVIDER_N_JSON_SCHEMA=         # "true" = ce provider honore response_format
                                   # json_schema (décodage contraint, Véracité v2 P3) :
                                   # le schéma est compilé dans le décodeur, une réponse
                                   # malformée devient impossible au lieu d'improbable.
                                   # Zéro surcoût (même appel, mêmes tokens) et seules
                                   # generate_signal + narrate_change envoient un schéma.
                                   # DÉFAUT OFF, à vérifier provider par provider : un
                                   # provider qui annonce le champ mais refuse notre
                                   # schéma répond 400, le SEUL statut sur lequel le pool
                                   # ne bascule volontairement pas (une requête mal
                                   # construite échouerait pareil partout). Vide = mode
                                   # json_object, identique à aujourd'hui
AI_PROVIDER_N_TPM_LIMIT=           # plafond TOKENS PAR MINUTE du provider (cerebras 30000, cloudflare 6000, mistral 60000,
                                   # groq 8000). C'est LE plafond qui mordait : le quota
                                   # journalier n'a jamais été atteint. Mesuré en prod le
                                   # 2026-07-31 — Cerebras sert 420k tokens sur l'heure de 05:00,
                                   # tape son plafond par minute, puis DISPARAÎT le reste de la
                                   # journée à 740k sur 1M, pendant que Groq répond à 169 appels
                                   # dans la même heure et en rate 152. Le pool ignorait
                                   # l'existence d'un plafond par minute, donc le fan-out horaire
                                   # 429ait le seul provider sain, le parquait jusqu'à 2 min, et
                                   # basculait tout sur celui qui pouvait le moins l'absorber.
                                   # `pickProvider` DÉPRIORISE désormais un provider dont la
                                   # fenêtre glissante ne peut pas financer la requête, sans
                                   # jamais l'exclure : l'estimation est un ratio sur un nombre de
                                   # caractères, pas un tokenizer, donc elle ne doit jamais être
                                   # la raison d'un échec. Le plancher reste le comportement
                                   # d'avant ; le gain est qu'un provider saturé est sauté AVANT
                                   # son 429, pas après. Réservation avant l'appel (sinon N appels
                                   # concurrents lisent tous une fenêtre vide et partent tous),
                                   # réconciliée sur l'usage réel dans le MÊME bucket de minute.
                                   # 0 = pas de pacing pour ce provider
AI_INTERACTIVE_RESERVE_FRACTION=0.2 # part de chaque plafond par minute réservée à l'INTERACTIF
                                   # (question Ask, brief signals, tout ce qu'un humain regarde).
                                   # Le background est plafonné aux 80% restants. Sans ça la
                                   # flotte et la personne devant l'écran tiraient sur le même
                                   # pot, et la flotte passe toujours en premier : c'est
                                   # exactement pourquoi un testeur SEUL voyait « AI insights are
                                   # delayed » sans que rien ne soit cassé. Le flag vit dans le
                                   # scope withAiContext et les scopes imbriqués en HÉRITENT, donc
                                   # un job que l'user regarde s'enveloppe une fois et tous ses
                                   # loggedAi sont interactifs. 0 désactive la réserve
AI_DEFER_BASE_SEC=150              # délai avant qu'un JOB refusé par le pool soit REJOUÉ. La
                                   # politique de retry de la queue est 1s avec backoff plafonné
                                   # à 10s : juste pour une panne transitoire, faux pour un rate
                                   # limit, puisque les tiers gratuits répondent au 429 en
                                   # demandant 18 à 60 s. Les 3 tentatives tombaient donc DANS la
                                   # fenêtre encore throttlée et le job échouait après 2 rondes
                                   # d'appels providers pour rien (mesuré sur 7 j : 333 appels
                                   # extract_pricing pour 184 pages pricing réellement changées).
                                   # Seul AIUnavailableError défère, et PAS quand le pool est
                                   # mal configuré ni quand la requête est trop grosse : ni l'un
                                   # ni l'autre ne guérit en attendant, donc les deux gardent le
                                   # retry normal et finissent en DLQ où quelqu'un les voit
AI_DEFER_JITTER_FRACTION=0.6      # étalement UNILATÉRAL de ce délai (jamais plus tôt que la
                                   # base). Sans lui, tous les jobs déférés par la même panne
                                   # reviennent au même instant et reconstruisent le burst qui a
                                   # causé la panne, une fenêtre plus tard
QUEUE_MAX_DEFERRALS=5             # nombre de reports qu'un job peut accumuler avant de retomber
                                   # sur le retry normal (puis la DLQ). Une BORNE, pas un réglage :
                                   # un pool durablement indisponible ne doit pas reprogrammer un
                                   # job indéfiniment, un job qui n'échoue jamais est un job dont
                                   # personne n'est prévenu. Compteur porté dans le PAYLOAD (clé
                                   # réservée `__deferrals`, retirée par `jobData`) : un report
                                   # RE-SEND le job, donc le compteur de retry pg-boss repart à
                                   # zéro et ne peut pas borner la boucle
AI_CIRCUIT_BREAKER_THRESHOLD=20   # échecs consécutifs (tous providers) avant coupure globale
AI_CIRCUIT_BREAKER_RESET_MIN=2    # minutes avant retry (breaker provider ET global)
AI_MAX_CONCURRENT_CALLS=4         # R9 — plafond PROCESS d'appels simultanés au pool. La
                                   # concurrence par queue n'est pas la concurrence du pool : 24
                                   # handlers portent un appel IA, ce qui met le plancher à ~22
                                   # appels en vol côté workers, plus l'api, et rien ne les
                                   # comptait. C'est le seul frein qui agit AVANT le 429 : les
                                   # breakers et les fenêtres TPM sont tous des réactions à un
                                   # 429 déjà encaissé. Le slot est tenu pendant TOUTE la marche
                                   # de failover, pas par tentative, sinon un appel qui a déjà
                                   # brûlé deux providers repasse derrière du travail neuf. Le
                                   # check du breaker global reste HORS du slot pour qu'un
                                   # blackout échoue vite au lieu de faire la queue. Trop bas
                                   # transforme un problème de tokens en problème de latence et
                                   # pousse les jobs vers leur `expireInSeconds` : se régler
                                   # contre le taux de jobs expirés. 0 désactive
AI_INTENSIVE_RATE_LIMIT=           # OVERRIDE d'urgence ops UNIQUEMENT. Le plafond horaire
                                   # d'actions IA discrétionnaires est PAR TIER depuis
                                   # 2026-07-31 (PLAN_LIMITS.aiActionsPerHour 20/40/120/300).
                                   # Renseigner cette var re-aplatit TOUS les tiers sur une
                                   # seule valeur — c'était l'état d'avant (10 pour free comme
                                   # pour business) et c'est ce qui rendait inatteignables les
                                   # caps par tier qu'elle surplombe (pro : 20 re-scans +
                                   # 50 battle cards / jour). La laisser VIDE
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
# Périmètre par tâche (P5, décidé par docs/faithfulness-rollout.md). Liste
# séparée par des virgules parmi : battle_card | digest | signal_insight. À poser
# sur le service WORKER uniquement — le gate ne tourne nulle part ailleurs.
# PRÉCÉDENCE : une valeur non vide GAGNE sur le booléen ci-dessus, dans les deux
# sens (elle active une tâche que le booléen laisse à false, et elle laisse hors
# gate toute tâche non listée même si le booléen vaut "true"). Le kill switch est
# donc de vider cette ligne, pas de toucher au booléen. Un nom non reconnu
# n'active rien : une faute de frappe doit échouer du côté « on publie ».
# Premier rollout recommandé : battle_card,digest — un faux blocage y reporte une
# sortie récupérable, là où un faux blocage sur une alerte critique ne l'est pas.
FAITHFULNESS_GATE_TASKS=

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
BATCHING_MAX_GROUPS=500                # max groupes batchés par run (1 appel IA chacun)

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
EXTRACTOR_HEAL_COOLDOWN_HOURS=12       # min heures avant de retenter un heal qui a ATTEINT un
                                       # provider et n'a produit aucun parser exploitable. Il
                                       # parque la PAGE, donc il n'est armé que par ce qu'on a
                                       # appris SUR la page. Armé sur les 3 sorties (spec qui ne
                                       # rejoue pas, génération parse-failed, erreur inattendue),
                                       # y compris quand AUCUNE ligne parser_extractors n'existe :
                                       # une 1re génération ratée sur un domaine inconnu ne
                                       # stampait rien, donc le scrape suivant re-payait
EXTRACTOR_HEAL_POOL_PAUSE_MINUTES=5    # durée pendant laquelle TOUS les heals d'un process worker
                                       # se mettent en retrait après un refus du pool IA (tous les
                                       # providers rate-limités, ou breaker global ouvert). Séparé
                                       # du cooldown ci-dessus parce qu'un échec de pool ne dit
                                       # RIEN de la page : la parquer 12h enregistrerait un fait
                                       # jamais constaté, et affamerait le chemin de heal, puisque
                                       # le pool est saturé exactement quand le fan-out horaire
                                       # tourne, c'est-à-dire quand la plupart des pages sont
                                       # capturées. Mesuré avant la séparation, sur 14 j en prod :
                                       # 405 des 656 appels generate_extractor n'ont jamais eu de
                                       # réponse, 45 heals seulement ont abouti pour 218 parsers
                                       # cachés, et 181 des 410 runs sur 7 j tombaient à moins de
                                       # CINQ MINUTES du précédent pour le MÊME concurrent (le
                                       # `catch` avalait l'erreur sans rien écrire, donc le
                                       # cooldown ne s'armait jamais sur ce chemin). Court par
                                       # construction : les tiers gratuits se rechargent en
                                       # continu, un 429 Groq demande des secondes. 0 désactive la
                                       # pause seule. 📄 docs/ai-consumption-audit-2026-08.md
EXTRACTOR_REVALIDATE_INTERVAL_DAYS=14  # R8 — âge max d'un parser caché avant régénération forcée contre le DOM courant (un sélecteur dérivé "plausible mais faux" ne peut plus être trusté indéfiniment). last_validated_at n'est plus stampé à chaque cache hit
EXTRACTOR_MAX_CONSECUTIVE_FAILURES=5   # R8 — échecs de replay consécutifs après lesquels un parser caché est distrusté d'office
                                       # E9 — le cooldown de heal ci-dessus est désormais
                                       # EXPONENTIEL par page (12 h → 48 h → 7 j) via
                                       # parser_extractors.consecutive_heal_failures : une page
                                       # que le générateur n'arrive pas à parser doit cesser
                                       # d'être re-générée au tarif plat pour toujours. Remis à 0
                                       # par un heal qui produit un parser. Et un spec expiré
                                       # n'est plus jeté d'office : quand le heal censé le
                                       # remplacer ne peut pas tourner (cooldown, ou pool qui ne
                                       # répond pas), il est rejoué quand même et le run est logué
                                       # en `stale_cache` au lieu de payer le modèle
PRUNE_HTML_MAX_CHARS=21000            # cap de l'HTML élagué envoyé au générateur de sélecteurs

# Platform auto-detection (patch-31)
PLATFORM_DETECTION_ENABLED=true        # false → pas de profil écrit, routage = comportement actuel exact
PLATFORM_REDETECT_INTERVAL_DAYS=30     # cadence re-détection périodique par competitor
PLATFORM_DNS_ENABLED=true              # résolution CNAME (signal 6, node:dns) ; false → skip
PLATFORM_STEP_B_ENABLED=true           # autorise le fallback navigateur (api-capture) si step A maigre
PLATFORM_REDETECT_DRIFT_COOLDOWN_HOURS=24  # min heures entre re-détections sur drift connecteur (self-heal)

# Visual diff (Phase 8) — before/after screenshots sur un signal (proxy R2 org-scopé,
# no-IA). La disponibilité est jugée sur le pHash du snapshot (= une PNG a été
# capturée), PLUS sur `source_type === homepage` : la homepage floore son scrape au
# navigateur donc capture toujours, et `pricing` capture désormais sur les runs qui
# rendent DÉJÀ (screenshotIfRendered — jamais une passe navigateur en plus ; 368 des
# 976 scrapes pricing mesurés sur 14j). Un snapshot `origin=archive` (backfill
# Wayback) ne peut porter aucune PNG : ces changes restent sans diff visuel.
# 📄 docs/visual-diff.md
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
AI_VISIBILITY_INTERVAL_DAYS=7          # âge à partir duquel un PRODUIT est dû. Le scheduler tourne
                                       # DÉSORMAIS TOUS LES JOURS et drip ce que le budget du jour
                                       # couvre, produit le plus ancien d'abord ; ce seuil est le
                                       # plancher qui empêche un budget en rab de re-poser une
                                       # question dont on a déjà la réponse
AI_VISIBILITY_MAX_PROMPTS=10           # cap prompts/produit/run (garde-fou coût)
AI_VISIBILITY_MIN_PROMPTS_FOR_SIGNAL=4 # min prompts répondus (par moteur, sur les DEUX runs) avant qu'un shift SoV soit signalé — sinon skip (1-2 prompts = quota gratuit épuisé, bruit 100%/50%, pas un vrai mouvement)
AI_VISIBILITY_MIN_REQUEST_GAP_MS=13000 # espacement min entre 2 appels au MÊME MODÈLE, tenu dans une
                                       # LIGNE Postgres (ai_visibility_engine_budget), plus en
                                       # mémoire de process : l'ancien pacer ne tenait pas face aux
                                       # runs que pg-boss prend en parallèle (mesuré 2026-08-01 :
                                       # 6 runs simultanés répondent 21 prompts sur 110, les mêmes
                                       # orgs seules en répondent 10 à 14 chacune). Le défaut vise
                                       # le plafond MESURÉ (5 RPM), pas l'annoncé
AI_VISIBILITY_GEMINI_MODELS=           # liste séparée par virgules qui REMPLACE le modèle unique.
                                       # Le cap de requêtes est PAR MODÈLE, donc chaque modèle
                                       # épinglé est une allocation gratuite de plus sur LA MÊME clé
                                       # et le même projet (mesuré 2026-08-01 : 2.5-flash,
                                       # 2.5-flash-lite et 3.6-flash affichent chacun /20 RPD). Un
                                       # prompt reçoit UN modèle par hash stable et le garde : deux
                                       # modèles ne nomment pas les mêmes marques, donc un prompt
                                       # qui change de rédacteur se lit comme un mouvement de SoV.
                                       # CONFIRMER que le grounding marche sur un modèle avant de
                                       # l'ajouter (un 429 peut n'être que le bucket du jour vidé)
AI_VISIBILITY_MODEL_DAILY_BUDGET=18    # plafond DUR côté code, par modèle et par jour UTC, appliqué
                                       # par une réservation dans ai_visibility_engine_budget avant
                                       # qu'un appel ne parte. Google énonce le plafond du free tier
                                       # dans son propre refus : quotaValue 20, par modèle, par
                                       # projet. Les 2 restants couvrent le « Run now » à la demande,
                                       # et le fait qu'un 429 consomme une réservation lui aussi
AI_VISIBILITY_TEASER_RESERVE=3         # appels/jour que le drip refuse de planifier, pour qu'une
                                       # rafale d'inscriptions trouve encore de quoi payer son teaser
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
NEXT_PUBLIC_API_URL=         # https://api.outrival.app
WEB_URL=                     # https://outrival.app (callbacks Stripe)

# Build provenance (Docker build args for @outrival/web, inlined at build time)
GIT_SHA=                     # deploying commit sha → surfaced by GET /api/version (stale-deploy check)
BUILD_TIME=                  # build timestamp → GET /api/version. In Coolify: pass SOURCE_COMMIT as GIT_SHA
```

