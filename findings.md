# Findings — Outrival

Découvertes techniques et décisions importantes accumulées au fil des sessions.

## Patch-05 — Widget feedback (2026-05-27)

### html2canvas
- Limites observées : images cross-origin nécessitent `useCORS: true` ET un CORS
  permissif côté serveur — sinon elles sortent transparentes. Les fonts en CSS
  variables (`var(--font-display)`) sont rendues correctement, mais certains
  effets (filter, mask, mix-blend-mode) sont parfois ignorés. Le sticky/fixed
  positioning est rendu à sa position d'origine (pas la position finale après
  scroll).
- Taille screenshot JPEG q=0.7 : typiquement 200-600KB pour un viewport
  dashboard 1440px. Cap dur côté API à 2MB (data URL ~2.8MB encodée) — assez
  pour 4K si besoin.
- Import dynamique (`await import("html2canvas")`) requiert un cast — le typage
  du package gère mal le `default` sous NodeNext + esModuleInterop. Pattern
  retenu : `(mod.default ?? mod) as unknown as ...` avec types inline.

### Slack ops (OPS_SLACK_WEBHOOK_URL)
- `sendSlackMessage()` dans `@outrival/shared/notify` est silencieux par
  design : aucun throw, aucun log. Une notif qui échoue ne doit JAMAIS
  faire échouer la soumission du feedback (constraint patch-05).
- Webhook ops distinct des `slackWebhookUrl` des orgs (table organizations).
  À configurer côté .env.local en prod (Slack workspace personnel ops).

### DB schema
- `pnpm db:push` requiert TTY pour les prompts de rename/data-loss. Solution
  retenue : `drizzle.config.ts` charge `.env.local` via dotenv automatiquement
  + `tablesFilter: ["!user", "!session", "!account", "!verification"]` pour
  exclure les tables Better Auth (gérées par BA, hors schema Drizzle). Pour
  prompts de data-loss : utiliser `--force` après revue manuelle du diff.
- Lors de l'application de patch-05, drizzle-kit a dropé 3 colonnes orphelines
  côté DB (changes.summary, monitors.last_failed_at, monitors.last_error)
  qui n'étaient plus dans les schemas src/ — cleanup naturel de la dette
  signalée par patch-03.

### Vue riche feedbacks
- Patch-05 livre la capture + stockage + ping Slack uniquement. La vue
  admin riche (filtres, statuts, screenshots inline) est dans patch-02.
- `GET /api/feedback` actuel = liste basique, owner-only. Pas d'UI dashboard.



## Architecture

- PostgreSQL Railway = données relationnelles. ClickHouse = time-series uniquement.
- R2 = tout asset binaire (HTML snapshots, screenshots). Jamais en DB.
- Trigger.dev concurrencyKey = hostname du concurrent pour éviter les bans IP.
- Groq classification AVANT Claude Sonnet — ne jamais envoyer un change non-significatif à Claude.

## Patterns établis

### Better Auth v1.6.11
- Pas de `schema` à passer à `drizzleAdapter` — Better Auth gère ses propres tables (user, session, account, verification).
- Import : `import { drizzleAdapter } from "better-auth/adapters/drizzle"` ✓
- `auth.api.getSession()` sur le serveur, `createAuthClient()` côté client (better-auth/react).
- Dashboard layout : `fetch` côté serveur vers `/api/auth/get-session` avec forwarded headers.

### Trigger.dev SDK v4.4.6
- Export `./v3` disponible : `import { task, logger } from "@trigger.dev/sdk/v3"` ✓
- `ctx.log()` N'EXISTE PLUS — utiliser `logger.log()` importé depuis le module.
- `maxDuration` est **requis** dans `TriggerConfig` (pas dans la doc de la SKILL.md).
- `runtime: "bun"` est valide (valeurs : "node" | "node-22" | "bun").
- Logging : `logger.log()`, `logger.info()`, `logger.error()` — jamais ctx.log.

### TypeScript monorepo
- `@types/node` requis dans chaque package qui utilise `process.env` ou `crypto`.
- Ajouter `"types": ["node"]` dans le tsconfig de chaque package concerné.
- `packages/db` + `apps/api` + `apps/workers` ont tous besoin de `@types/node`.
- `apps/web` : `@types/react` + `@types/react-dom` requis pour les JSX types.
- `apps/web` tsconfig doit inclure `"lib": ["ES2022", "DOM", "DOM.Iterable"]`.

### Tailwind v4
- Pas de `tailwind.config.ts` — configuration via `@import "tailwindcss"` dans le CSS.
- `postcss.config.mjs` requis avec `@tailwindcss/postcss`.
- `tw-animate-css` pour les animations shadcn/ui.

## Erreurs connues et solutions

- `tsc --filter` n'existe pas — toujours utiliser `pnpm typecheck --filter @outrival/pkg` (turbo).
- Si `cd apps/workers && git add apps/workers/` → pathspec error. Toujours faire `git add` depuis la racine du repo.

## Phase 2 — Scraping Core

### Crawlee / Playwright
- `PlaywrightCrawler` retient les pages visitées → un second `crawler.run([url])`
  avec la même URL ne ré-exécute pas le handler. Toujours instancier un crawler frais
  par appel `scrape()` ou appeler `await crawler.teardown()` après chaque run.
- `page.goto({ waitUntil: "networkidle" })` ne suffit pas pour les SPA modernes —
  prévoir un `waitForSelector` optionnel par scraper.
- `page.screenshot()` retourne déjà un `Buffer` côté Node, mais le typage Playwright
  expose `Buffer | Uint8Array`. Wrapper avec `Buffer.from(...)`.
- `headless: true` par défaut OK pour dev.

### R2 / S3 client
- Endpoint R2 : `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` + `region: "auto"`.
- ContentType requis sur upload — sinon Cloudflare sert sans MIME (curl OK mais le browser
  voit `application/octet-stream`).
- Convention de clé : `snapshots/{competitorId}/{sourceType}/{ISO_timestamp}.{html|png}`.
  Pas de slash final, pas d'extension dans le `r2Key` stocké en DB
  (on append `.html` / `.png` au moment du fetch).

### Heuristiques scraping
- Pricing : si l'URL contient déjà `pricing|tarifs|plans|tarification`, on l'utilise tel quel,
  sinon on essaye `/pricing`, `/tarifs`, `/plans`, `/price` en cascade (premier qui retourne
  >50 chars wins).
- Blog : `/blog`, `/changelog`, `/news`, `/updates`, `/posts` — CheerioCrawler (statique)
  car la plupart sont SSR.

### Diff
- `diffLines` du package `diff` est suffisant pour Phase 2 (texte seul).
- `diffText` stocké tronqué à 50KB en DB pour éviter de spammer la table changes.
- `rawDiff` (jsonb) stocke `{ added, removed }` complet — analysable IA en Phase 3.

### Job scrape-monitor — pattern critique
- **Toujours upload R2 AVANT insert snapshot** (règle scraping). Si upload fail, throw →
  Trigger.dev retry, pas de row orpheline en DB.
- Idempotence : skip si snapshot < 1h sauf `force: true` (utilisé par le bouton "Scraper
  maintenant").
- Hash identique → update `monitor.lastRunAt` mais pas de nouveau snapshot ni change.
- `tasks.trigger("scrape-monitor", {...})` depuis l'API : pas besoin de typer le payload,
  le job le valide via Zod.

### API multi-tenant
- `ensureUserOrg(userId)` crée une org perso au premier accès si l'utilisateur n'en a pas
  (Phase 1 n'a pas implémenté l'onboarding org). Toutes les routes passent par ce helper
  pour récupérer `orgId`.

## Phase 3 — Intelligence IA

### Groq via `groq-sdk`
- `response_format: { type: "json_object" }` est supporté par `llama-3.3-70b-versatile`
  — toujours combiner avec un prompt qui demande explicitement "UNIQUEMENT JSON valide".
- Le SDK Groq retourne `res.choices[0]?.message?.content` (peut être undefined → fallback "").
- Pour les longs diffs : truncate à ~8KB dans le prompt pour rester sous les limites de
  contexte et limiter le coût (le diffText est déjà tronqué à 50KB en DB).

### Pattern provider abstrait
- `complete(config, options)` dans `packages/ai/src/provider.ts` switch sur `config.provider`.
- Clients Groq/Anthropic instanciés lazy via getter — sinon trigger:dev crash quand
  `GROQ_API_KEY` est absent à l'import des jobs.
- `aiEnv()` est une fonction lazy (pas un export top-level parsé) pour la même raison.

### Trigger.dev v3 — patterns Phase 3
- `tasks.trigger("task-id", payload)` par string ID est suffisant — pas besoin du
  generic `tasks.trigger<typeof ...>` qui force un import circulaire entre jobs.
- `schedules.task({ id, cron, run })` v3 : `payload.timestamp` est dispo dans `run`.
- Toujours `maxDuration` requis (en secondes) dans la config du task.
- Idempotence pipeline : `signals.changeId` est unique de facto — check avant insert
  dans BOTH classify-change ET generate-signal (le 2e protège contre les race conditions).

### ClickHouse best-effort
- `signal_feed` insert wrap try/catch + log — si CLICKHOUSE_URL absent, skip avec warn.
- Permet au pipeline de fonctionner sans ClickHouse provisioned (validation produit d'abord).
- Table à créer côté ClickHouse manuellement (DDL non automatisé pour l'instant).

### Resend / Slack
- Slack webhook : POST JSON `{ text }` suffit — pas besoin de blocks pour l'alerte.
- Resend `from` : nécessite un domaine vérifié — fallback `alerts@outrival.io` en config.
- Erreurs Slack/email : log + insert ligne `alerts` avec `error` au lieu de throw.
  → garde le pipeline robuste (alerte ratée ≠ signal perdu).

### Digest hebdomadaire
- Idempotence par `(orgId, weekStart)` — recherche existing avant generate.
- Skip orgs sans signal sur la semaine (pas de digest vide → spam évité).
- `weekStart`/`weekEnd` au format ISO date (YYYY-MM-DD) pour matcher Drizzle `date()`.
- HTML email inliné directement dans `lib/digest-email.ts` (pas de templating engine).

### UI signals
- `activity-feed.tsx` (ancien feed Changes bruts) remplacé par feed Signals.
- L'ancienne page `/dashboard` (Activité) sert maintenant le feed Signals avec sévérité,
  catégorie, insight, so_what, recommendedAction + bouton "marquer comme lu".
- Pas de page `/dashboard/changes` distincte — les Changes restent visibles via API.

## Phase 4 — Competitor Discovery

### Exa.ai (exa-js v2)
- `findSimilarAndContents(url, { numResults, excludeDomains, text })` retourne `{ results: [{ url, title, text }] }`.
- `text.maxCharacters: 500` suffit pour donner du contexte à Groq pour scorer l'overlap.
- Toujours `excludeDomains: [hostname(productUrl)]` pour ne pas retourner le produit lui-même.
- Client instancié lazy via `getExa()` — sinon import du package onboarding crash si EXA_API_KEY manque au démarrage.

### Scoring d'overlap batché
- Un seul appel Groq (maxTokens 2048) pour les 15 candidats — 5-10x plus rapide
  que 15 appels séparés et bien meilleur résultat car le LLM voit l'ensemble.
- Le LLM renvoie parfois moins d'entrées que de candidats — toujours faire un mapping
  par URL et défaulter à 0 pour les missing.
- Snake_case dans le format LLM (`overlap_score`) puis remap en camelCase côté JS.

### ProductProfile camelCase
- Schéma drizzle org.productProfile typé via `$type<{ category, audience, valueProp, pricingModel }>()`.
- LLM instruit en camelCase via le prompt — pas besoin de remap après parse.

### Onboarding synchrone vs Trigger.dev Realtime
- Pour des appels <15s qui ne se font qu'une fois, le sync API est gagnant :
  pas de coût Realtime, code UI simple (spinner + await), debug trivial.
- Trigger.dev reste pour le premier scrape (peut prendre 30s+, peut fail) — décorrélé du flow UI.

### Subpath exports @outrival/scrapers
- `./discovery` et `./quick-fetch` exposés séparément pour ne pas pull `crawlee`/`playwright`
  dans l'API. L'API n'a besoin que d'Exa + fetch ScrapingBee.
- Pattern à reproduire si d'autres packages mêlent du lourd et du léger.

### quickFetchText
- ScrapingBee `render_js=false` suffit pour extraire le texte d'une homepage (95% des cas).
- Pipeline regex : strip script/style/tags + collapse whitespace → texte propre prêt pour Groq.
- Seuil de 100 chars en sortie pour rejeter les pages trop maigres (cold pages, redirects).

### Discovery flow API
- `/onboarding/discover` ne crée RIEN en DB — c'est juste un appel scoring.
- `/onboarding/complete` est le seul endpoint qui crée competitors + monitors.
- Concurrents pré-cochés côté UI si overlapScore > 60 (heuristique testée à itérer).

### Garde dashboard layout
- Fetch `/api/onboarding/status` server-side avec forwarded headers (même pattern que getSession).
- Redirect vers `/onboarding` si `!onboardingCompleted` — surgical, 4 lignes ajoutées.

## Phase 5 — Enrichissement

### ClickHouse intégré côté @outrival/db

- Client partagé `getClickhouse()` + proxy `ch` dans `packages/db/src/clickhouse.ts`
  → utilisé à la fois par l'API (chQuery best-effort) et le script `pnpm ch:setup`
- Workers gardent leur propre `lib/clickhouse.ts` avec helpers `insertPricingHistory`,
  `insertJobCounts`, `insertReviewScore`, `insertSignalFeed` (best-effort + logger)
- `ensureClickhouseTables()` (packages/db/src/clickhouse-schema.ts) crée pricing_history,
  job_counts, review_scores, signal_feed avec ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
- Script CLI : `pnpm --filter @outrival/db ch:setup` (bun run + dotenv.config({path: "../../.env.local"}))

### ClickHouse best-effort côté API

- `apps/api/src/lib/clickhouse-safe.ts` wrap toutes les queries ClickHouse en try/catch
- Retourne `[]` si CLICKHOUSE_URL absent → la fiche concurrent reste fonctionnelle
  même sans ClickHouse provisioned (utile en dev local)
- Pattern `toString(recorded_at) AS recorded_at` pour avoir une string sérialisable JSON

### Routing scrape-monitor (surgical)

- Après création du Snapshot (et avant l'update lastRunAt), routing par sourceType :
  - pricing → trigger("extract-pricing", { snapshotId, competitorId })
  - jobs → trigger("extract-jobs", { snapshotId, competitorId })
  - g2_reviews | capterra_reviews → trigger("extract-reviews", { snapshotId, competitorId, source })
- La logique de diff/Change/classify reste inchangée → pipeline IA Phase 3 continue
- Surgical : ~12 lignes ajoutées, aucune logique existante touchée

### Détection offres fermées (extract-jobs)

- Signature d'une offre = lowered(title) + "::" + lowered(department)
- Algorithme :
  1. Fetch toutes les jobPostings actives du concurrent
  2. Set des signatures dans l'extraction Groq
  3. Inserts = présents dans extraction mais pas en DB
  4. Closures = en DB mais absents de l'extraction → set isActive=false + closedAt
- Garde-fou `inArray(jobPostings.id, closedIds)` pour limiter le `update`

### Reviews : table verbatims réutilisée pour praises/complaints

- Pas de schema change : on stocke un row par praise et par complaint
- `author = "praise" | "complaint"` (le champ author n'a pas d'usage existant)
- `content` = la phrase courte extraite par Groq
- `score` = average_score global (dénormalisation pratique pour la liste)
- ClickHouse review_scores reçoit l'agrégat (score moyen, sentiment, nombre)
- À normaliser Phase 6+ avec une table `review_summaries` dédiée

### G2 / Capterra via ScrapingBee premium

- `premium_proxy: true` + `render_js: true` obligatoires (G2 sert peu de contenu sans JS)
- Pas de screenshot retourné (Buffer.alloc(0)) — coût trop élevé via ScrapingBee
- L'URL doit être fournie par l'utilisateur via `monitor.config.url`
  (auto-discovery G2 URL = futur — heuristique nom + slug)

### Heuristique pages carrières (jobs.scraper)

- Candidates : /careers, /jobs, /join-us, /carrieres, /career, /about/careers,
  /company/careers, /work-with-us — premier qui retourne >50 chars wins
- Si l'URL contient déjà un mot-clé carrières → utilisée telle quelle (skip cascade)
- Détection ATS via regex sur le HTML rendu : Greenhouse, Lever, Ashby, Workable,
  Recruitee, SmartRecruiters → stocké dans `metadata.atsDetected`
- N'extrait pas les offres directement — délégué à `extract-jobs.job.ts` via Groq

### Recharts dark + amber

- Couleurs palette : ["#F59E0B" amber, "#22d3ee" cyan, "#a855f7" purple, "#10b981" green,
  "#ef4444" red, "#f97316" orange] cycle modulo
- CartesianGrid stroke = var(--border), Tooltip background = var(--bg)
- Pricing : LineChart par plan_name (X = date courte, Y = prix)
- Job trends : LineChart par department (90 derniers jours)
- Review scores : LineChart par source (domain Y = [0, 5])
- Format date court via toLocaleDateString("fr-FR", { day, month })

## Décisions de design

- Outrival = dark theme, amber (#F59E0B), Syne + Inter
- shadcn/ui new-york style, radius 6px, flat surfaces
- CSS custom properties pour toutes les couleurs (--background, --surface, --accent, etc.)
- Logo : "Out" blanc + "rival" amber, font Syne
- Tabs custom (pas de @radix-ui/react-tabs installé) — boutons + underline amber
  pour l'état actif, transparent sinon

## Phase 6 — Battle Cards & Alertes

### Génération battle card (Groq)

- `generateBattleCard(input)` via `AI_CONFIG.insights` (Groq llama-3.3-70b)
- Prompt XML structuré : `<my_product>`, `<competitor>`, `<reviews>`, `<recent_signals>`
- maxTokens 2048 — battle card complète sort en ~3-6s
- Inputs collectés côté workers : org.productProfile, competitor.aiSummary,
  praises/complaints (8 max chacun), 8 derniers signals
- Si Groq retourne du JSON malformé → safeParseJson retourne ok:false → null
  → AbortTaskRunError côté job (pas de retry inutile sur même prompt cassé)

### PDF Playwright

- `chromium.launch({ headless: true })` puis `page.setContent(html, { waitUntil: "networkidle" })`
  puis `page.pdf({ format: "A4", printBackground: true, margin: 0 })`
- `Buffer.from(...)` autour du retour `page.pdf()` (typage Playwright = Buffer | Uint8Array)
- Toujours `await browser.close()` dans un `finally` — sinon fuite si erreur
- Playwright doit être déclaré dans `dependencies` d'apps/workers (pnpm strict),
  même si `packages/scrapers` l'a déjà — un workspace dep ne donne PAS accès
  aux subdeps depuis le sibling
- Template HTML inline (lib/battle-card-html.ts) avec @page A4, margin 16mm,
  break-inside: avoid sur les sections, font-family Inter + Syne (fallbacks system)

### R2 — binaire vs texte

- `uploadToR2(key, body, contentType)` accepte string OU Buffer (déjà ok)
- `getFromR2(key) → string` existant via `transformToString()`
- Nouveau `getBytesFromR2(key) → Uint8Array` via `transformToByteArray()`
  pour servir des binaires (PDF) via `new Response(bytes, ...)` côté Hono
- Convention de clé PDF : `battle-cards/{competitorId}/{ISO_timestamp}.pdf`
- `pdfR2Key` stocké en DB après l'upload R2 (jamais l'inverse)

### Routes API battle-cards

- `app.route("/api/competitors", competitorsRouter)` puis
  `app.route("/api/competitors", battleCardsRouter)` fonctionne en Hono :
  les deux routers partagent le prefix, chacun dispatch ses propres chemins
  (`/:id` vs `/:id/battle-card`)
- Réponse PDF : `Content-Disposition: attachment; filename="battle-card-{slug}.pdf"`
  où slug = `competitor.name.replace(/[^\w-]+/g, "-").toLowerCase()`

### SSE Hono — pattern temps-réel

- `import { streamSSE } from "hono/streaming"` — natif Hono, zéro dep
- Boucle infinie `while (!aborted)` avec `stream.sleep(3000)` entre polls
- `stream.onAbort(() => { aborted = true })` capture la déconnexion client
- Tracking via `lastCheck = new Date()` mis à jour seulement au `createdAt` de la
  dernière notif émise (pas à `new Date()` à chaque tour) — évite de manquer
  une notif créée entre `findMany` et reset de `lastCheck`
- Heartbeat `event: "heartbeat"` toutes les 3s pour maintenir la connexion
  vivante côté proxies/load balancers (Coolify/Nginx coupent à 60s d'idle)
- Event au connect : `event: "ready"` avec timestamp (debug latence côté client)

### EventSource côté navigateur

- `new EventSource(url, { withCredentials: true })` — cookies envoyés
  (Better Auth session cookie nécessaire pour authMiddleware)
- `es.addEventListener("notification", ...)` pour les events nommés
  (pas `onmessage` qui ne reçoit que les events sans `event:`)
- EventSource gère l'auto-reconnect par défaut → on n'a rien à coder
- `es.close()` dans le cleanup useEffect — sinon connexion zombie sur navigation

### Notifications — création surgical depuis send-alert

- Insert dans `notifications` AVANT la branche Slack/email (l'in-app marche
  même si Slack/email sont désactivés ou échouent)
- Type `signal` pour les alertes liées à un Signal, `new_competitor` pour la détection
- `linkUrl` toujours relatif (`/dashboard/competitors/{id}` ou `/dashboard/candidates`)
  pour permettre router.push() ou anchor href direct

### Detect new competitors — pattern dedup

- Filtrer les concurrents existants ET les candidates déjà vus
- Comparaison URL exacte (set d'URLs) + comparaison par hostname normalisé
  (lowercase, strip `www.`) — Exa peut retourner le même site avec/sans www
- `competitor_candidates.url` est la dedup key fonctionnelle (jamais re-alerter)
- Status `new` → en attente, `added` → ajouté à la veille, `dismissed` → ignoré
- Cron `0 20 * * 0` (dimanche 20h UTC) — assez tard pour ne pas bloquer
  d'autres jobs en heures ouvrées européennes
- Seuil overlap > 65 codé en const `MIN_OVERLAP` — facile à tweaker

### UI Battle Card — édition inline

- Mode view = ul/li read-only, mode edit = inputs/textareas inline
- Pas de form/zod côté client — l'API valide le payload PATCH avec son propre Zod
  schema dupliqué (cohérent mais simple)
- Polling 3s pendant `status === "generating"` jusqu'à `pdfR2Key` non-null
- Bouton "Télécharger PDF" désactivé tant que `pdfR2Key` est null (PDF en attente)
- Bouton "Régénérer" relance le job mais garde le contenu actuel visible
  (UX : on ne perd pas l'éditable pendant la régénération)

## Patch 01 — Coût scraping (direct-first + reschedule adaptatif)

### Direct-first scraping (packages/scrapers/src/lib/crawler.ts)

- `scrapePage(url, opts)` tente Playwright direct (gratuit) en premier, fallback
  ScrapingBee (premium_proxy + render_js) seulement si `looksBlocked` détecte un
  blocage. Retourne `ScrapeOutcome { ...result, usedProxy: boolean }`
- `looksBlocked(html, statusCode)` conservateur (mieux vaut un faux positif → proxy
  qu'un faux contenu stocké) : status 403/429/503, html < 500 chars, captcha,
  cf-challenge, "attention required", "access denied", "just a moment"
- `runCrawler(url, { useProxy, fullPage, waitForSelector })` factorise les deux modes :
  useProxy=true → scrapeViaScrapingBee, useProxy=false → PlaywrightCrawler direct
- `statusCode` ajouté à `ScraperResult` — exposé par Playwright via `response?.status()`
  et par Cheerio via `response?.statusCode`
- `preferProxy: true` saute la tentative directe (utile pour sites connus protégés)

### Scrapers : passthrough preferProxy

- Tous les scrapers acceptent `(competitorId, url, options?: ScrapeOptions)` et
  retournent `ScrapeOutcome` (structurellement compatible avec ScraperResult)
- homepage, pricing, jobs, blog : passent `options.preferProxy` à scrapePage
- g2-reviews et capterra-reviews : **forcent** `preferProxy: true` (sites connus
  protégés → évite une tentative directe inutile et le crédit consommé en double)
- blog reste sur scrapeStatic (CheerioCrawler) — pas de proxy car blogs typiquement
  pas derrière anti-bot

### Apprentissage proxy (scrape-monitor)

- `monitor.requiresProxy` (default false) est passé en `preferProxy` à chaque scrape
- Après chaque scrape, si `outcome.usedProxy && !monitor.requiresProxy` → set
  `requiresProxy = true` → le prochain scrape ne refait pas la tentative directe
- Pas de retour à false automatique : un site qui demande le proxy une fois est
  considéré protégé à vie (conservatif)

### Reschedule adaptatif (packages/shared/src/scheduling.ts)

- `computeNextRun(frequency, lastChangedAt, createdAt, now?)` calcule le prochain run
- BASE_INTERVAL_MS : realtime=1h, daily=24h, weekly=7d
- MAX_INTERVAL_MS (plafond) : realtime=12h, daily=5d, weekly=30d
- stalenessMultiplier : ×1 (<14j) → ×2 (<45j) → ×3 (<90j) → ×4 (>=90j)
- La fréquence utilisateur est un **plancher** (jamais accéléré au-delà), le
  multiplicateur est un **plafond** (jamais plus lent que MAX_INTERVAL_MS)
- `lastChangedAt` mis à jour côté scrape-monitor uniquement quand un Change est
  inséré → un site qui ne change plus voit son nextRunAt s'éloigner naturellement
- Si lastChangedAt est null, on fallback sur createdAt (premier scrape post-création)

### Schedule-scraping

- Aucune modif nécessaire — était déjà dans l'état cible (`isActive && (nextRunAt
  null || nextRunAt <= now)` → enqueue). Toute la logique de reschedule vit
  désormais dans scrape-monitor (chaque monitor se reprogramme après son propre run)

### Pattern TS — closures et spread

- `let result: ScraperResult | null = null` assigné dans un closure puis check
  `if (!result) throw` → TS ne narrow PAS le type dans la branche suivante à cause
  du closure. Solution : `const captured = result as ScraperResult | null` puis
  check → permet le narrow. (S'applique au spread `{ ...result, usedProxy }`
  mais pas au simple `return result`.)

## Phase 7 — Monétisation

### Stripe SDK v22 + TypeScript NodeNext

- Le module `stripe` v22 publie une shape "weird" en CJS : `export = StripeConstructor`
  où StripeConstructor est callable mais son namespace ne contient que `type Stripe = ...`
  → `Stripe.Customer`, `Stripe.Event` etc. ne sont PAS accessibles par défaut
  via `import Stripe from "stripe"` quand TS résout en CJS (notre config)
- Workaround : utiliser l'inference plutôt que les types namespace
  - `export type StripeClient = InstanceType<typeof Stripe>` pour l'instance
  - `type StripeEvent = ReturnType<StripeClient["webhooks"]["constructEvent"]>`
  - `type StripeSubscription = Extract<StripeEvent, { type: "customer.subscription.created" }>["data"]["object"]`
  - Évite d'avoir à passer en `"type": "module"` dans apps/api/package.json
- `apiVersion: "2026-04-22.dahlia"` (la version la plus récente que le SDK accepte ;
  ne pas garder une vieille version genre `2025-04-30.basil` même si la doc Stripe
  semble la suggérer — TS rejette)

### Webhook Stripe en Hono

- Mounté à `/api/stripe/webhook` AVANT les autres routes `/api/*` (pattern défensif
  même si Hono ne consomme pas le body globalement avec nos middlewares actuels)
- Pas de authMiddleware sur ce router — la signature Stripe (`stripe-signature`
  header + `STRIPE_WEBHOOK_SECRET`) authentifie l'event
- Raw body via `await c.req.text()` dans le handler — Hono n'a pas besoin de
  config spéciale pour préserver le raw body comme Express/Fastify
- `stripe.webhooks.constructEvent(rawBody, signature, secret)` throw si invalide
  → retourner 400 "invalid_signature"
- Pour retrouver l'orgId depuis un event : 3 sources de vérité (Customer.metadata,
  Subscription.metadata, Session.metadata) + fallback DB lookup par stripeCustomerId
  → robuste si une des sources manque

### Plan limits dans @outrival/shared

- PLAN_LIMITS est la source unique de vérité (api gating, web UI, paywalls, workers)
- `business.maxCompetitors = Number.POSITIVE_INFINITY` → ne pas le serializer en JSON.
  L'API retourne `limit: null` dans `/api/billing` quand `Number.isFinite(...)` est false
  pour ne pas casser le client. L'UI affiche "illimité"
- `PLAN_PRICING` typé avec `satisfies Record<Exclude<Plan, "free">, Record<BillingPeriod, number>>`
  pour autocomplete sans perdre les valeurs littérales

### Mapping price ID ↔ plan/period

- 6 vars d'env : `STRIPE_PRICE_{STARTER|PRO|BUSINESS}_{MONTHLY|YEARLY}`
- `getPriceId(plan, period)` lit l'env à l'appel (lazy, pas de cache global)
- `lookupPlanByPriceId(priceId)` itère sur les 6 combinaisons pour retrouver
  le plan+period quand le webhook reçoit un priceId
- Aucune config "dure" dans le code — le mapping est piloté par l'env. Permet
  de changer les prix ou ajouter un plan annuel sans redéployer

### Gating dans send-alert.job (workers)

- `if (limits.features.realtimeAlerts)` autour de l'insert notifications →
  les free users ne voient pas la bell (cohérent avec realtimeAlerts: false)
- Slack envoyé seulement si `limits.allowedChannels.includes("slack")` ET
  `org.slackWebhookUrl` set
- Email reste toujours envoyé (email channel dans tous les plans)
- Surgical : 3 conditions ajoutées, pas de refacto

### ApiError côté web

- Nouvelle classe `ApiError extends Error` dans `apps/web/src/lib/api.ts`
- Porte `status`, `code` (parsé depuis `data.error`), et `data` (le payload JSON)
- Le wrapper `request()` essaie de parser le body en JSON, fallback en texte
- `paywallFromError(err)` extrait un `PaywallReason` (avec plan, limit, used,
  feature, source, frequency, channel) si l'erreur est une 403 avec code
  plan_*, sinon retourne null → chaque call site fait `if (reason)` pour
  ouvrir le paywall ou fallback sur l'erreur classique

### Paywall pattern

- Un seul composant `PaywallDialog` qui prend `{ reason: PaywallReason | null, onClose }`
- Switch sur `reason.code` pour la copy. Maps en haut du fichier pour FEATURE_LABEL,
  SOURCE_LABEL, CHANNEL_LABEL → ajout d'une nouvelle source/feature = 1 ligne
- Bouton primaire "Voir les plans" → Link vers `/dashboard/settings/billing`
  + onClose pour fermer le dialog avant la navigation (évite flash)
- Position fixed → peut être rendu n'importe où dans l'arbre, pas besoin de Portal
- Pour battle-card-tab (5 return statements possibles), variable intermédiaire
  `const paywallNode = <PaywallDialog .../>` + wrap fragment des branches qui
  ont un bouton onGenerate

## Patch 04 — Observabilité (2026-05-27)

### Sentry — projets & DSN

- 3 projets Sentry distincts pour triage par service :
  - `outrival-api` → DSN dans `SENTRY_DSN_API`, init dans `apps/api/src/lib/sentry.ts`
  - `outrival-workers` → DSN dans `SENTRY_DSN_WORKERS`, init dans `apps/workers/src/lib/sentry.ts`
  - `outrival-web` → DSN serveur dans `SENTRY_DSN_WEB`, DSN client dans
    `NEXT_PUBLIC_SENTRY_DSN` (préfixe Next.js obligatoire pour exposer au browser).
    Init via `src/instrumentation.ts` (serveur/edge) + `src/instrumentation-client.ts`
- Sentry n'est **activé qu'en `NODE_ENV=production`** sur les 3 services
  (`enabled: process.env.NODE_ENV === "production"`). Dev = silent.
- `tracesSampleRate: 0.1` partout (rester dans le free tier). À ajuster
  selon le volume réel après lancement.
- `sendDefaultPii: false` partout — pas d'auto-capture des headers/IP.
- **Session Replay Sentry désactivé** côté web (`replaysSessionSampleRate: 0`,
  `replaysOnErrorSampleRate: 0`). PostHog gère le replay (patch-03 — pas
  encore appliqué) pour éviter de payer deux fois.
- Source maps web : upload automatique via `withSentryConfig` quand
  `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` sont présents. Sinon skip silencieux.
- Source maps workers : `@sentry/esbuild-plugin` ajouté dans
  `trigger.config.ts` (extension `esbuildPlugin`), gated sur `SENTRY_AUTH_TOKEN`
  + `SENTRY_ORG` + `NODE_ENV=production`.
- Hook global Trigger.dev : `onFailure` dans `trigger.config.ts` capture
  toute exception non-gérée vers Sentry avec tags `taskId` + `runId`.

### pino — logger partagé

- Source unique : `packages/shared/src/logger.ts`. Réexport via index.ts.
- Redaction PII : passwords, tokens, apiKeys, secrets, authorization headers,
  cookies, emails, stripeCustomerId, DATABASE_URL — censurés `[REDACTED]`.
- Mode dev : `pino-pretty` (colorisé). Mode prod : JSON streamé sur stdout
  (Coolify capture et persiste).
- Niveaux contrôlés via `LOG_LEVEL` (défaut `info`).
- Helper `childLogger(context)` pour des loggers enrichis (job id, orgId, etc.)
- Surgical : remplacement des `console.error` aux points critiques uniquement
  (`apps/api/src/lib/clickhouse-safe.ts`, `apps/api/src/routes/stripe-webhook.ts`).
  Les workers utilisent déjà `logger` de `@trigger.dev/sdk/v3`.

### Health checks

- `GET /health` — alias de `/live` (compat existante).
- `GET /health/live` — liveness pur, no deps. Pour uptime monitors externes
  (ping toutes les 1 min sans amplifier la charge DB).
- `GET /health/ready` — readiness profond :
  - `db` (Postgres) → `SELECT 1` via Drizzle, **requis**
  - `clickhouse` → `client.ping()` (ne throw pas, retourne `{ success }`),
    **optionnel** : si `CLICKHOUSE_URL` absent → `"skipped"` (200), si présent
    et fail → `false` (503)
  - **redis** non testé : Upstash retiré en Phase 6, SSE DB-backed à la place
- Retourne `{ status: "ok" | "degraded", checks: {...} }` avec status 200/503.

### Uptime monitoring (à configurer — externe)

À faire AVANT le launch beta (par l'utilisateur — pas codé, juste config) :

1. **Better Stack ou UptimeRobot (free tier)** :
   - Monitor `https://api.outrival.io/health/live` — ping 1/min, alerte si !200
   - Monitor `https://outrival.io` — ping 1/min, alerte si !200
   - Optionnel : monitor `/health/ready` à 5/min — alerte sur "degraded"
2. **Notification** : email + Slack channel `#alerts` (à créer).

### Alertes Sentry → Slack (à configurer — externe)

1. **Intégration Slack** dans Sentry workspace (settings → integrations).
2. **Règles d'alerte conservatrices** (anti alert-fatigue) :
   - Nouvelle issue (jamais vue auparavant) → notif Slack `#alerts`
   - Pic d'erreurs (>10 events en 5 min sur la même issue) → notif Slack
   - **NE PAS** alerter sur chaque occurrence d'une issue connue.
3. Séparer les channels par sévérité si besoin (`#alerts-critical` pour `outrival-api` 5xx).

### À remplir en prod

- `SENTRY_DSN_API` / `SENTRY_DSN_WORKERS` / `SENTRY_DSN_WEB` / `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` (Settings → Auth Tokens → Internal Integration)
- `SENTRY_ORG` (slug de l'org Sentry)
- `SENTRY_PROJECT_WEB` (défaut: `outrival-web`)

### Log shipping (étape 7 — différée)

Pour plus tard : `@axiomhq/pino` transport ajouté à `packages/shared/src/logger.ts`
quand le volume justifie l'investissement. Free tier Axiom = 500 GB/mois.
Au lancement, les logs Coolify (VPS) + dashboard Trigger.dev couvrent l'essentiel.

## Patch 03 — Analytics PostHog Cloud EU (2026-05-27)

### Configuration projet

- Cloud EU obligatoire : `api_host: https://eu.i.posthog.com`, `ui_host: https://eu.posthog.com`.
- Init dans `apps/web/src/lib/posthog/provider.tsx` avec :
  - `opt_out_capturing_by_default: true` (RGPD strict, rien avant consentement)
  - `person_profiles: "identified_only"` (pas de profil anonyme)
  - `capture_pageview: false` (App Router → capture manuelle dans `pageview.tsx`)
  - `autocapture: true` (clics + interactions)
  - `session_recording.maskAllInputs: true` + `maskTextSelector: "[data-ph-mask]"`
- Provider no-op si `NEXT_PUBLIC_POSTHOG_KEY` absent ou contient `REPLACE_ME` → dev local fonctionne sans key.

### Consentement (RGPD)

- Cookie `ph_consent` (`granted` | `denied`), `SameSite=Lax`, max-age 6 mois.
- Helpers : `apps/web/src/lib/consent.ts` (`getConsent`, `setConsent`).
- Bannière : `apps/web/src/components/outrival/consent-banner.tsx`, mountée
  globalement dans `apps/web/src/app/layout.tsx`. Affichée uniquement si
  `getConsent() === "unset"`. "Accepter" → `setConsent("granted")` +
  `posthog.opt_in_capturing()`. "Refuser" → `setConsent("denied")` (PostHog
  reste opt-out).
- Au mount du provider, si `getConsent() === "granted"` → opt-in immédiat
  (sinon attendre clic Accepter).

### Identification

- `posthog.identify(userId)` après login/signup réussi (forms client).
- `apps/web/src/lib/posthog/identity-sync.tsx` re-sync `identify(userId, { plan })`
  côté dashboard layout (server-driven, garantit que les refresh restent identifiés).
- `posthog.reset()` au logout (user-menu + onboarding signout).
- **JAMAIS l'email comme propriété de personne** — uniquement `userId` + `plan`.

### Masquage PII pour session replay

- `maskAllInputs: true` couvre tous les `<input>` automatiquement.
- `data-ph-mask` ajouté sur :
  - Email user dans `apps/web/src/components/dashboard/user-menu.tsx`
  - Section complète `apps/web/src/app/dashboard/settings/billing/page.tsx`
  - Wrapper `NotificationSettingsForm` dans `apps/web/src/app/dashboard/settings/page.tsx`

### Events client (10)

Tous via `apps/web/src/lib/posthog/events.ts` → `track()` gated par
`posthog.__loaded && has_opted_in_capturing()`.

| Event | Déclenché par |
|-------|---------------|
| `user_signed_up` | `register-form` après `signUp.email` ok |
| `onboarding_started` | mount onboarding-form |
| `onboarding_product_analyzed` | step 1 → 2 (analyze ok) |
| `onboarding_competitors_found` | step 2 → 3 (discovery ok, `count`) |
| `onboarding_completed` | `completeOnboarding` ok (`competitorCount`) |
| `competitor_added` | `createCompetitor` ok (manual dialog), `source: "manual"` |
| `scrape_triggered` | `runMonitor` ok (`sourceType`) |
| `battle_card_generated` | `generateBattleCard` ok (`competitorId`) |
| `paywall_shown` | PaywallDialog open (`reason`) |
| `paywall_cta_clicked` | Click "View plans" dans PaywallDialog (`reason`) |

### Events server-side (3)

- `apps/api/src/lib/posthog.ts` : `captureServerEvent(distinctId, event, props)`,
  flush après chaque capture. No-op si `POSTHOG_API_KEY` absent ou `REPLACE_ME`.
- `apps/workers/src/lib/posthog.ts` : idem + `shutdownPostHog()` à appeler
  en fin de run (processus court).
- `distinctId` = owner user de l'org (premier user par `createdAt asc`).

| Event | Déclenché par | Source |
|-------|---------------|--------|
| `plan_upgraded` | Subscription created/updated active | `apps/api/src/routes/stripe-webhook.ts` |
| `plan_cancelled` | Subscription deleted | idem |
| `signal_generated` | Nouveau signal inséré | `apps/workers/src/jobs/generate-signal.job.ts` (avant `shutdownPostHog()`) |

### Feature flags

- `useFeatureFlagEnabled("kill-switch-discovery")` sur `handleProfileConfirm`
  dans `onboarding-form.tsx` — bloque l'appel Exa avec message de fallback
  "Discovery temporarily disabled" si toggle on dans PostHog.
- Pattern de démo pour kill switches + rollout progressif sans redéploiement.

### Résolutions de conflits dependencies

- `pnpm.overrides {"@opentelemetry/api": "1.9.0"}` ajouté à `package.json` root.
  Sans cet override, `posthog-node` + `@sentry/node` (1.9.1) + `trigger.dev` (1.9.0)
  produisaient deux instances de `drizzle-orm` peer-resolvées différemment,
  causant des erreurs TypeScript "Types have separate declarations of a private
  property" dans le workers typecheck (notamment `send-alert.job.ts:40`).
- `apps/api/src/lib/auth.ts` : suppression du paramètre `schema` dans
  `drizzleAdapter(db, { provider: "pg" })`. Better Auth gère ses propres tables
  (user, session, account, verification). Le code précédent référençait
  `sessions/accounts/verifications` non exportés par `@outrival/db` — bug pré-existant
  qui passait grâce au cache Turbo, exposé après réinstall posthog-node.

### Status build (2026-05-27)

- 6/7 packages typecheck propre : shared, db, ai, scrapers, api, workers ✓
- `@outrival/web` : 16 erreurs TS pré-existantes (refs vers `Monitor.lastFailedAt`,
  `Monitor.lastError`, `api.refreshCompetitorSummary`, `ChangeRow.summary`,
  `ChangeRow.monitorUrl`, `CompetitorSignal.monitorUrl`, `CompetitorSignal.sourceType`,
  `Competitor.stats`, `topbar.compact`, `api.classifyChange`). Ces erreurs sont
  du WIP utilisateur antérieur à patch-03 — l'API/types/components ont divergé
  pendant que l'UI était en cours de redesign. À nettoyer dans un commit séparé,
  sans rapport avec PostHog.

### À remplir en prod

- Créer projet PostHog Cloud EU → coller key dans `NEXT_PUBLIC_POSTHOG_KEY` +
  `POSTHOG_API_KEY` (même key, exposée client + utilisée server-side).
- Activer Session Replay + Feature Flags dans le projet PostHog.
- Créer feature flag `kill-switch-discovery` dans PostHog (toggle on pour
  désactiver discovery onboarding en cas de problème Exa).
- Page `/privacy` à créer (lien depuis la bannière de consentement — placeholder
  pour l'instant, à brancher à la politique de confidentialité légale).
