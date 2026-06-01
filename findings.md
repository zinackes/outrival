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

### Bug Trigger.dev × pino (patch-04 fallout résolu)
- Symptôme : `pnpm trigger:dev` plante avec
  `Cannot find module '.trigger/tmp/build-*/lib/worker.js'`.
- Cause : pino spawn un worker thread (via `thread-stream`) qui charge
  `lib/worker.js` via `__dirname` au runtime. esbuild bundle pino dans la
  sortie, `__dirname` pointe sur le bundle dir → résolution cassée.
- Fix : externaliser `pino`, `pino-pretty`, `thread-stream` dans
  `apps/workers/trigger.config.ts` (`build.external`). Pino reste dans
  node_modules au runtime, ses chemins internes worker survivent.
- À surveiller : tout package qui spawn un Node worker thread doit être
  externalisé. Candidats futurs : `fflate`, modules de file-watching.



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

## Patch 07 — Perf scraping (appliqué PARTIELLEMENT, 2026-05-31)

Le patch décrivait 5 leviers mais a été écrit pour une archi qui ne matche pas
la prod. **Runtime réel : Trigger.dev cloud = une machine isolée par run**
(cf. commentaire `scrape-monitor.job.ts` + reference_trigger-worker-health).
Toute structure in-memory est donc reconstruite vide à chaque run.

### Appliqué

- **gzip HTML sur R2** (`packages/shared/src/r2/client.ts`) : `uploadToR2(..., { compress: true })`
  gzip le HTML + `ContentEncoding: gzip` ; `getFromR2` détecte et `gunzip` (anciens
  snapshots sans ContentEncoding lus tels quels → backward-compat). Seul le HTML
  est compressé (PNG/PDF jamais). Call site : `scrape-monitor.job.ts` upload `.html`.
- **Conditional fetch** (etag / last-modified) : pré-flight GET avant scrape sur
  sources server-rendered. 304 → skip total (pas de download, pas de crawlee/Chromium
  chargé, pas d'upload R2), reschedule via `computeNextRun`. Helper natif `fetch`
  dans `packages/scrapers/src/lib/conditional-fetch.ts` exporté en subpath
  `@outrival/scrapers/conditional-fetch` (n'importe PAS crawlee → un 304 ne lance
  jamais Chromium). Fail-open : toute erreur → pas de skip. `force=true` bypasse.
  - Snapshots étendus : `etag`, `last_modified`, `resolved_url` (3 colonnes nullable).
  - `resolvedUrl` = `result.metadata.url` (l'URL réellement fetchée, request.url) —
    indispensable car blog/pricing font de la *path-discovery* depuis `competitor.url`,
    donc l'etag doit porter sur la ressource exacte, pas la homepage.
  - Validateurs capturés depuis la réponse Playwright (`response.headers()`) ET
    Cheerio (`response.headers`) dans `crawler.ts`.
  - Gating `supportsConditionalFetch()` (`packages/shared/src/constants/sources.ts`)
    = **blog + changelog uniquement**.

### NON fait (à reconsidérer plus tard)

- **Étape 2 — Browser pool** : SKIP. Aucune cible (l'onboarding analyze utilise
  `quickFetchText` = fetch+ScrapingBee, pas Playwright direct ; Crawlee pool déjà ;
  seul `chromium.launch` direct = PDF battle-card one-shot). + machine isolée/run
  → un browser persistant cross-run n'existe pas.
- **Étape 4 — undici global agent** : SKIP. Pas de keep-alive réutilisable entre
  runs (machine isolée). Bénéfice théorique seulement côté API long-lived (Hono),
  mais les SDK (Stripe/Exa/Resend) poolent déjà. → conditional fetch fait en
  `fetch` natif, pas de dep `undici` ajoutée (étape 0 annulée).
- **Étape 5 — Domain throttle in-memory** : SKIP. La Map serait vide à chaque run.
  Le throttle réel existe déjà : `scrapeMonitorQueue.concurrencyLimit: 5` +
  concurrencyKey Trigger.dev. Migrer vers Redis si throttle cross-run requis.
- **`jobs` exclu du conditional fetch** : les pages ATS sont souvent des SPA et un
  faux 304 masquerait la détection de clôture d'offres (`extract-jobs`). Revisiter
  si les pages carrières s'avèrent envoyer des etags fiables.
- **Si les workers passent un jour à un process long-lived** → réévaluer 2/4/5.

### Note commit

Le commit gzip (`feat(shared): gzip...`) a absorbé du WIP pré-existant non commité
sur `scrape-monitor.job.ts` (queue/machine preset, routing appstore, refresh-summary,
refactor `changedAt`) — le working tree n'était pas clean au démarrage. Code cohérent
et typecheck OK, mais le message de commit ne reflète pas ce WIP.

---

## Patch-08 — Onboarding par stade de projet (2026-05-31)

Refonte étape 1 onboarding : 4 stades (idée / document / developing / live), tous
convergent vers le même `ProductProfile`. Implémenté ; commits laissés à l'utilisateur
(working tree avait 102 fichiers WIP non commités au démarrage — décision : "j'implémente,
tu commites").

### Adaptateurs ProductProfile (packages/ai/src/profile/)
- 4 adaptateurs purs : `fromDescription` / `fromDocument` / `fromRepo` / `fromUrl`.
  Tous → `ProductProfile` (type unique réexporté depuis `tasks/analyze-product`, pas de
  type concurrent). Pattern Groq `AI_CONFIG.classification` + `safeParseJson`.
- `fromUrl(text)` = wrapper typé sur `analyzeProduct` — packages/ai NE PEUT PAS importer
  `@outrival/scrapers` (quickFetchText), donc le fetch reste côté API. Idem unpdf/mammoth
  (document) et fetch GitHub (repo) : extraction/fetch dans l'API, ai ne voit que du texte
  ou des artefacts déjà extraits → package pur conservé.

### Routes API (apps/api/src/routes/onboarding.ts)
- `/analyze` renommé en `/analyze-url` (2 appelants web mis à jour : onboarding-form +
  workspace-settings-form). Nouvelles : `/analyze-description`, `/analyze-document`
  (multipart), `/analyze-repo`, `PATCH /progress`, `POST /skip`. `/status` étendu
  (`projectStage`, `onboardingStep`, `onboardingSkipped`), `/complete` set `onboardingStep="done"`.
- Échec d'analyse → **422 `{ error, fallback: "description" }`** ; le front propose de
  basculer en mode description sans recommencer.
- Helpers découplés de l'auth : `lib/github.ts` (`fetchRepoArtifacts`, Result-typed,
  404=repo privé) et `lib/extract-document.ts` (`extractDocumentText`). L'authMiddleware
  ne sert qu'à récupérer `orgId` pour le store.

### Discovery sans URL
`findSimilarCompanies(productUrl: string | null, ...)` : les modes idée/document/repo
n'ont pas d'URL produit. Null → on saute l'exclusion hostname/marque ; la query sémantique
(`buildDiscoveryQuery`) pilote la recherche Exa de toute façon. Route `/discover` :
`productUrl` désormais `.nullish()`. Callers existants (detect-new-competitors.job) non
impactés (string assignable à string|null).

### ZÉRO-STOCKAGE mode Document — garanties (vérifiées au niveau code)
- Le fichier n'est JAMAIS écrit sur disque ni uploadé R2. Audit grep confirmé : aucune
  call `fs.`/`writeFile`/R2/`putObject` dans le chemin document (route + helper).
- Extraction 100% en mémoire : `bytes = new Uint8Array(await file.arrayBuffer())` scopé au
  handler, libéré (GC) au retour. PDF→unpdf `extractText(bytes,{mergePages:true})`,
  DOCX→mammoth `extractRawText({buffer})`, md/txt→`Buffer.toString("utf-8")`.
- `bodyLimit({ maxSize: 10MB })` (hono/body-limit) + `Cache-Control: no-store` sur la route.
- Logs : `hono/logger` ne log pas les bodies ; pino `redact` étendu (`req.body`, `*.file`).
  Aucun `console`/`logger` du contenu dans le chemin document.
- Sentry : `beforeSend` dans `apps/api/src/lib/sentry.ts` → si l'URL contient
  `/onboarding/analyze-document`, `event.request.data = "[REDACTED — document upload]"`.
- **TODO test runtime (manuel, hors implémentation)** : upload PDF réel → inspecter disque
  (`find` temp dirs), bucket R2, logs pino, events Sentry → aucune trace ; puis crash
  volontaire de la route → erreur dans Sentry SANS contenu du fichier.

### URL temporaire (packages/shared/src/url.ts)
`detectTemporaryUrl(url)` — TEMPORARY_HOSTS (localhost, 127.0.0.1, .vercel.app,
.netlify.app, .ngrok*, .replit.dev). WARNING non bloquant côté front (mode live), propose
de basculer en mode "developing".

### Web (apps/web)
- `onboarding-form.tsx` réécrit en machine 5 écrans (stage → input → profile → discover →
  monitoring → done). Persistance via `PATCH /progress` à chaque transition ; reprise au
  step sauvé (discover/monitoring resume → discover + re-run discovery, la liste de
  concurrents n'étant pas persistée).
- `page.tsx` : redirect dashboard seulement si `onboardingCompleted && step === "done"`
  (laisse passer skip + re-onboarding).
- Skip : `OnboardingBanner` (token couleur `accent`, pas d'amber hardcodé) affichée si
  `onboardingSkipped && !profile` ; garde dashboard autorise si completed OU skipped.
- Re-onboarding : section "Stade du projet" dans `WorkspaceSettingsForm` (pas de page
  dédiée — évite un doublon d'édition du profil). Bouton → `patchOnboardingProgress("stage")`
  + redirect `/onboarding`. NE supprime PAS les concurrents (`/complete` ne fait qu'insert).
- `lib/api.ts` : helper `postForm` (multipart sans Content-Type), `analyzeDescription/
  analyzeDocument/analyzeRepo/analyzeUrl`, `patchOnboardingProgress`, `skipOnboarding`,
  types `ProjectStage`/`OnboardingStep`.
- `Github` icon n'existe plus dans lucide-react@1.16 (icônes de marque retirées) → `GitBranch`.

### Indicateur live première session (done screen)
Best-effort : poll `listCompetitors` toutes les 5s (40 tentatives max), "analysé" =
`aiSummary != null` (proxy du pipeline scrape→classify→summary). Pas d'endpoint de
progression dédié — informatif, ne bloque jamais "Aller au dashboard".

### Architecture isolable pour mode public futur (étape 9)
Logique d'analyse 100% dans des helpers réutilisables sans session : adaptateurs
`packages/ai/src/profile/*`, `fetchRepoArtifacts`, `extractDocumentText`. Les routes
analyze-* sont de fines couches auth(orgId)+store. Pour exposer en public plus tard :
nouvelle route `/api/public/analyze-idea` (réutilise `fromDescription`) + rate-limit
Upstash par IP + captcha invisible Turnstile. Aucune route publique créée dans ce patch.

### Schéma
`organizations` + `projectStage` (text), `onboardingStep` (text), `onboardingSkipped`
(boolean default false). `db:push` direct (additif non destructif), "Changes applied".

### Vérif
`pnpm typecheck` 7/7 ✓ · `pnpm build` 7/7 ✓ (build = tsc --noEmit partout, pas de next build).
0 nouvelle erreur TS. Reste : test E2E runtime des 4 modes + vérif zéro-stockage live
(nécessite services + creds GROQ/EXA/R2/DB + session auth).

---

## Patch-09 — Optimisation coût IA (2026-06-01)

3 leviers : cache Redis sur tâches déterministes, filtre de significativité, routing
modèle 8b/70b. Le patch a été écrit pour une archi qui ne matche plus la prod — deux
hypothèses fausses corrigées (cf. décisions ci-dessous).

### Redis réintroduit (Upstash REST) — cache IA uniquement
- Le patch importait `../redis` (« client Upstash existant ») : **faux**, Upstash a été
  retiré en Phase 6 (SSE DB-backed). Réintroduit `@upstash/redis` dans `@outrival/shared`
  (`src/redis.ts`, client lazy `getRedis()`), **pour le cache IA seulement**.
- **Pourquoi Upstash et pas un Redis self-host sur le VPS** : les workers (donc
  `classifyChange`, le plus gros volume) tournent sur **Trigger.dev Cloud**, pas sur le
  VPS. Le client REST Upstash est joignable de partout ; un Redis VPS devrait être exposé
  sur Internet (TLS + auth) pour les workers Cloud. À reconsidérer si les workers passent
  un jour sur le VPS.
- **Dégradation silencieuse** : `getRedis()` renvoie `null` si `UPSTASH_REDIS_REST_URL`/
  `_TOKEN` absents → `withAiCache` appelle `fn()` direct, rien ne casse. Toute erreur
  réseau Redis (get/set) est avalée. Dev + prod-sans-Upstash fonctionnent identiquement.
- `withAiCache(input, { namespace, ttlSeconds }, fn)` dans `packages/shared/src/cache/`.
  Clé = `ai:{namespace}:{sha256(input)[:24]}` — **jamais** de secret dans la clé, hash du
  contenu seul. `@upstash/redis` sérialise/désérialise le JSON tout seul (pas de
  `JSON.parse` manuel, contrairement au snippet du patch écrit pour ioredis).
- **Les `null`/`undefined` ne sont jamais cachés** → un parse failure est re-tenté au
  prochain appel au lieu d'être figé pour tout le TTL. `score-overlap` retourne `null`
  dans le `fn` en cas d'échec (pas le fallback array) pour que le fallback ne soit jamais
  mis en cache.

### Routing modèle via `AI_CONFIG`, pas un système `MODELS`/`ModelTier`
- Le patch proposait `MODELS = { fast, smart }` + `complete({ model: "fast" })`. La vraie
  API est `complete(config: AITaskConfig, options)` et le routing modèle se fait **déjà**
  via les clés d'`AI_CONFIG`. Ajouter un `MODELS`/`ModelTier` parallèle aurait dupliqué
  cette abstraction → écarté (Simplicity First).
- Ajout d'**une** entrée `AI_CONFIG.classificationFast` (`groq` + `llama-3.1-8b-instant`).
  `classify` + `score-overlap` pointent dessus (8b). `analyze-product` **reste** sur
  `classification` (70b) — profiling produit = raisonnement plus riche (contrainte patch).
  Tout le reste (insight/digest/battle-card/extract-*/summaries) inchangé sur 70b.

### Cache appliqué SANS changer les signatures publiques
- Décision : wrapping cache **interne** aux tâches, signatures inchangées
  (`classifyChange → Classification|null`, etc.), `console.debug("[ai-cache] hit …")`
  dans `withAiCache`. Raison : le flag `cached` n'a **aucun consommateur** tant que
  patch-02 (`ai_runs` + `logAiRun`) n'est pas appliqué — exposer `{ result, cached }` +
  migrer tous les appelants = du churn pour rien. À rebrancher avec patch-02.

### Filtre de significativité — placement
- Helper pur `evaluateSignificance({ added, removed })` dans `packages/ai/src/filters/`,
  exposé en **subpath `@outrival/ai/significance`** (comme `@outrival/scrapers/
  conditional-fetch`) → `scrape-monitor` l'importe sans tirer groq/anthropic au parse.
- Placé dans **`scrape-monitor.job.ts`** juste avant `tasks.trigger("classify-change")` :
  le diff `{ added, removed }` y est déjà calculé, le **Change reste inséré** (historique
  préservé), et on économise à la fois le run Trigger ET l'appel Groq. `diff.added`/
  `removed` sont des `string[]` → joints en `\n` au call site.
- `logAiRun` / statut `skipped`/`cached` **non implémentés** : table `ai_runs` n'existe
  pas (patch-02 pas appliqué). Le patch prévoit ce cas — à brancher avec patch-02.

### Heuristique : règles partiellement masquées (pas un bug)
- Mesuré via les tests unitaires : un diff **timestamps-only** (quasi aucune lettre) est
  attrapé par la **règle 2 `no_significant_text`** avant la règle 4 `timestamps_only` ;
  un **hash court** (<50 chars) par la règle 1 `too_short`. La règle 4 est de fait
  **dead code** (son charset n'autorise que `T`/`Z` comme lettres → impossible d'avoir
  ≥30 chars « significatifs »). Le diff est **bien skippé** dans tous les cas (`worth:
  false`) — seul le `reason` exact diffère. Helper **non modifié** (heuristique imposée
  par le patch, conservatrice, comportement correct). Tests assertent `worth` ; le
  `reason` n'est pinné que sur les règles réellement atteignables (hash long, token long).

### Tests
- Repo sans runner de test → introduit **`bun test`** (Bun déjà le runtime api/workers,
  zéro nouvelle dep). `packages/ai` : script `"test": "bun test"`, `tsconfig` exclut
  `**/*.test.ts` (sinon `bun:test` casserait `tsc --noEmit`). 8 tests verts.

### Mesures runtime (TODO — 24h-7j, nécessite creds Upstash + patch-02)
- Taux de cache hit classify (objectif 30-50 %), taux de skip (30-60 %), volume Groq
  (-60 à -80 %). À lire dans le dashboard ops (patch-02) une fois `ai_runs` branché.
- Vérifs runtime non faisables ici : cache hit observable (2e appel = hit), Redis coupé →
  app continue, `llama-3.1-8b-instant` dans les logs Groq pour classify/score vs
  `llama-3.3-70b-versatile` pour signal/digest/battle-card.

### Vérif
`pnpm typecheck` 7/7 ✓ · `pnpm build` 7/7 ✓ · `bun test` (@outrival/ai) 8/8 ✓.
0 nouvelle erreur TS.

---

## Patch 11 — Pricing detection taxonomy (2026-06-01)

### Architecture vs the patch's assumptions
The patch's file paths assumed a Phase-5 layout that differs from reality:
- Scraper = `packages/scrapers/src/pricing/pricing.scraper.ts` (fetches HTML only).
- Tier extraction stays AI-side in `extract-pricing.job.ts` (Groq → ClickHouse),
  NOT in the scraper. The scraper does not return `tiers`.
- The 6-status taxonomy lives on the `competitors` table (Postgres); the
  ClickHouse `pricing_history` got `status`/`promotional`/`observed_region`.
- Pure detectors live in `scrapers/pricing/` (cheerio only). Exposed to workers
  via a new pure subpath `@outrival/scrapers/pricing` so scrape-monitor never
  pulls crawlee/Chromium at parse time.
- `PricingStatus` + `detectPricingRepositioning` live in `@outrival/shared`.

### Signal routing (key constraint)
`signals.changeId` is notNull + a unique-ish FK, so a pricing change routes to
exactly ONE outcome in scrape-monitor: promo → no signal · status transition →
dedicated repositioning signal (replaces the generic diff signal, via
generate-signal's `pricingTransition`) · otherwise → the generic classify
pipeline. Confirmed with the user (transition replaces generic).

### Real-fixture findings (captured 2026-06-01, committed under __fixtures__)
Static SSR HTML was enough for all four — the distinguishing content was in the
markup, not JS-only, once the regexes were fixed:
- **Linear** → `public` (prices visible; Enterprise "Contact" CTA is JS-rendered
  so the static fixture doesn't see it — matches the patch's expected `public`).
- **Notion** → `public_partial` (€/$ prices + "Contact us" on Enterprise).
- **Crayon** → `gated_demo` (no prices, "Get a Demo").
- **Segment** → `dynamic` (no static prices, usage-based "Monthly Tracked Users").

### Regex gaps that only surfaced on real markup (not theory)
1. Gated CTAs: the patch's list missed **"get a demo" / "schedule a demo" /
   "talk to an expert"** — Crayon uses "Get a Demo", so it mis-detected as
   `unknown` until added.
2. Usage-based: added **pay-as-you-go / usage-based / "based on usage" /
   "monthly tracked users" / MTU** to the calculator detector — Segment's slider
   is a custom component (no `<input type=range>`), so vocabulary is the only
   static signal of a `dynamic` page.
3. Accented FR promo terms: `\b` forms no word boundary next to é/É (not `\w` in
   JS regex), and `[ée]` under `/i` doesn't match `É` (i only folds ASCII). Fixed
   "Économisez", "offre limitée", "durée limitée" by dropping the `\b` and
   spelling out É.

### Caveats / future improvements
- `discoverPricingUrl` trusts HEAD 2xx for direct paths → soft-404 hosts (200 on
  any path) could mislead it; the homepage nav/footer fallback is more reliable.
- Local Playwright capture hung on `networkidle` for analytics-heavy pages
  (Linear/Segment never go idle). Fixtures were taken from static SSR instead,
  which is faithful here because the status-deciding content is server-rendered.
- `unknown` rate to watch in prod: only Crayon-style pages with non-standard CTAs
  risk it now that demo vocabulary is broad. Surfaced in the UI with a manual
  "Fill in" override (pricingManualOverride) that scrapes never overwrite.

### Verification
`pnpm typecheck` 7/7 ✓ · `pnpm build` 7/7 ✓ · `bun test packages/scrapers/src/pricing`
45/45 ✓ · `db:push` applied (6 competitor columns) · `ch:setup` applied
(pricing_history taxonomy columns, ALTER ADD COLUMN IF NOT EXISTS for existing).
Runtime end-to-end (live scrape → status stored → repositioning signal → email)
not exercised here — needs GROQ/R2/DB creds + a Trigger.dev run.

---

## Patch-12 — Monitoring du produit utilisateur / self-competitor (2026-06-01)

Le site user est traité comme un "concurrent spécial" (`type="self"`, `isUserProduct=true`)
réutilisant l'infra Phase 5. Q1=B (fiche complète : extraction IA features+stack), Q2=A
(commits laissés à l'utilisateur — working tree avait du WIP patch-11 concurrent).

### Divergences réelles vs patch (le patch décrivait une archi inexistante)
- **Pas de `enrich-competitor.job`** : l'« enrichissement Phase 5 » = monitors par source
  (`homepage`/`pricing`/`jobs`) → `scrape-monitor` → `extract-pricing`/`extract-jobs` +
  `refresh-competitor-summary`. La création du self (helper `createSelfCompetitor` dans
  `onboarding.ts`) sème ces monitors + un scrape `force:true` par monitor (pattern de
  `/complete` et `candidates.add`). Aucun job d'enrichissement unique.
- **Le signal se déclenche dans `classify-change.job`** (pas `scrape-monitor`, contrairement
  au step 4 du patch). Interception du self là : après classification, si
  `competitor.type==="self"` → insert `self_product_changes` + `notifySelfChange`, `return`
  AVANT `generate-signal`. AUCUN signal / signal_feed / alerte pour le self.
- **Pas de table `competitor_profiles`** : profil riche éditable dans un jsonb
  `competitors.selfProfile`, **par champ** `{ value, isFromAutoDetect, lastEditedByUserAt }`
  (category/audience/valueProp/features/techStack). Pricing reste sur colonnes patch-11
  (`pricingStatus`… + `pricingManualOverride`), jobs dans `job_postings`.
- **`org` n'a ni `productName` ni `productRepoUrl`** : self gated par `org.productUrl` seul
  (modes idea/document = pas d'URL = pas de self) ; nom dérivé via `normalizeHostname`.
- **Web sous `dashboard/`** → `app/dashboard/my-product/page.tsx` (pas `(dashboard)`).
- `Classification` réelle = `{ category, severity, is_significant, reason }` — le patch
  inventait des `type:"category_change"`. `determineSelfChangeSeverity` mappe
  `severity ∈ {high,critical}` → `major`, sinon `minor`.

### Modèle de mise à jour du profil (cohérence)
- **Auto-détecté rafraîchi / édits user sticky** : `extract-self-profile.job` (nouveau,
  prompt `extractSelfProfile` 70b, déclenché après chaque homepage scrape du self)
  recalcule features+techStack et n'écrase un champ QUE si `isFromAutoDetect !== false`
  (et jamais avec un résultat vide). PATCH `/my-product` passe le champ édité à
  `isFromAutoDetect=false` + `lastEditedByUserAt=now` → sticky contre les scrapes suivants.
- **`accept` n'écrit PAS le profil depuis le diff** : les `self_product_changes` issues de
  classify-change portent des **lignes de diff brutes** (pas `pricing.tiers[1].price`). Le
  profil auto-détecté est déjà tenu à jour en continu par le pipeline. Donc `accept` =
  acquitter (status accepted) + suggestion re-discovery si `major` ; `modify` = status
  modified (édition via PATCH) ; `ignore` = status ignored. Idempotence retries via
  `self_product_changes.changeId` (unique, nullable — Postgres autorise plusieurs NULL).

### Re-scan & cadence
- `USER_PRODUCT_RESCAN_DAYS` (défaut 14) lu côté API à la création : seed `nextRunAt`.
  Monitors self en `frequency="weekly"` (l'enum n'a que realtime/daily/weekly ; 14j non
  représentable) → cadence réelle gouvernée par `computeNextRun` (patch-01). Bouton
  "Re-scan" = `POST /my-product/rescan` (force par monitor).

### Exclusion du self (cross-feature)
- `ne(competitors.type, "self")` ajouté à : liste competitors (`competitors.ts` GET /),
  search, feed changes org-wide, quota (`plan.ts countActiveCompetitors`). Discovery :
  **aucun changement** — self est dans `existing` de `detect-candidates` (dédup hostname)
  ET Exa exclut déjà le domaine `productUrl` (= URL du self). Reviews self : pas de monitor
  reviews créé + garde `competitor.type !== "self"` dans le routing reviews de scrape-monitor.

### Déféré (non bloquant)
- Édition inline du pricing sur /my-product (PATCH le supporte ; UI read-only — le pricing
  tab patch-11 fournit déjà l'override manuel).
- Battle card "côté nous" depuis `selfProfile` (génère encore depuis `org.productProfile`).
- Re-discovery ne re-score pas l'overlap des concurrents existants (ajoute suggestions +
  préserve via `detectCandidates`). Pas de "re-scoring view" dédiée.
- `self_change` : notification in-app seulement (pas d'email Resend dupliqué).

### Concurrence working tree (cf. MEMORY concurrent-auto-committer)
- Pendant l'implémentation, du WIP patch-11 (pricing-repositioning, `analyzePricingHtml`
  dans scrape-monitor, exports `ai/index.ts` + `api.ts` web + `PricingStatus`) a été mergé
  par un process tiers. Vérifié à chaque étape que mes edits survivaient (grep + typecheck).
  0 conflit. Commits NON faits (Q2=A) → laissés à l'utilisateur.

### Runtime TODO (manuel — services + creds requis)
- Onboarding "live" avec URL → self créé + 3 monitors + scrape forcé → /my-product riche.
- Forcer un changement du site → `self_product_changes` pending, vérifier `signals`/
  `signal_feed` VIDES pour le self. Accept(major) → modal re-discovery.
- Mode "idea" (sans URL) → pas de self, page affiche l'état vide "Set a product URL".

### Vérif
`pnpm typecheck` 7/7 ✓ · `pnpm build` 7/7 ✓. 0 nouvelle erreur TS (les 16 erreurs web
pré-existantes patch-03 ont disparu entre-temps — web clean). `db:push` applied
(competitors.type/isUserProduct/selfProfile + notification_type self_change +
self_product_changes table).

---

## Patch 13 — Intelligence sectorielle (méso) — implémenté 2026-06-01

Couche méso : croise les concurrents d'une MÊME org pour détecter des tendances.
Réutilise 100% des données déjà collectées. Distinct des signals micro.

### Sources réelles utilisées (≠ ce que le patch imaginait)
- **Features** = `signals` `category="product"` (déjà classifiés + significatifs), PAS
  une catégorie `feature_added` (inexistante). Thèmes via **buckets de mots-clés**
  (matching par token, pas substring → "ai" ne matche pas "email"). FEATURE_THEMES :
  AI, integrations, mobile, security, analytics, collaboration, automation.
- **Hiring** = `job_postings` (department + title) → ROLE_CATEGORIES (sales, ai/ml,
  engineering, marketing, product, design, support).
- **Pricing** = ClickHouse `pricing_history.price` (Float64), variation médiane des
  prix moyens début↔fin de fenêtre par concurrent.
- **Positioning** = ClickHouse `pricing_history.status` (taxonomie patch-11), timeline
  open→gated (gated_demo/contact_sales/gated).
- `logAiRun`/`ai_runs` (patch-02) **n'existent pas** → remplacé par `logger.log("formulate_sectoral", …)`.

### Seuils & formules de confidence (à recalibrer avec la vraie distribution)
- **feature_trend** : candidat si ≥40% des concurrents ET ≥2 partagent un thème ;
  `confidence = share` (count/total). Publié si ≥ SECTORAL_MIN_CONFIDENCE (0.6) → en
  pratique ≥60% des concurrents.
- **hiring_trend** : candidat si ≥3 concurrents même catégorie ; `confidence = share`.
  ⚠️ Sur une grande org (8+ concurrents), 3 recruteurs = 0.375 < 0.6 → non publié.
  Voulu (vraie "tendance"), mais à surveiller (faux négatifs sur grosses orgs).
- **pricing_trend** : ≥3 concurrents avec trajectoire réelle, |Δmédian| > 10% ;
  `confidence = |Δ| / 0.2` → 12% = 0.6 (= seuil), 20%+ = 1.0.
- **positioning_shift** : ≥2 concurrents open→gated ; `confidence = 0.4 + 0.2·(n−1)`
  → 2 = 0.6 (= seuil), 4+ = 1.0. (Pas basé sur le share : 2 gating = signal fort
  même dans une grande org.)

### Garde-fous codés explicitement (constraints du patch)
- **a. Confidence threshold** : aucun signal publié si confidence < SECTORAL_MIN_CONFIDENCE
  (0.6). Filtre `significant = patterns.filter(p => p.confidence >= minConfidence)`.
- **b. Min concurrents** : `analyzeOneOrg` skip propre (return -1, log) si < SECTORAL_MIN_COMPETITORS
  (4) concurrents actifs (non deleted, `type != "self"`).
- **c. Pas d'inter-org** : `loadOrgSectoralData(orgId, …)` ne lit QUE les concurrents de
  l'org. Aucune query cross-org. La route API filtre `eq(orgId)`. RGPD-clean.
- **d. Pas de prédiction** : le prompt formulate interdit explicitement le forecasting
  ("Describe what IS happening, not what WILL happen. No forecasting."). L'enum
  `category_emergence` existe mais aucun détecteur ne l'émet (réservé futur).
- **e. Pas de sources externes** : tous les patterns viennent de Postgres (`signals`,
  `job_postings`) + ClickHouse (`pricing_history`). Zéro RSS/news API.

### Décisions d'archi
- Détecteurs = fonctions **pures** dans `packages/ai/src/sectoral/detectors.ts` (aucun
  I/O, aucune IA). Testés via `bun test` (10 tests, fixtures 8 concurrents + piège
  anti-faux-positif "email"). Le job assemble les données et appelle les détecteurs.
- IA **uniquement** pour la formulation (`formulate.ts`, modèle `AI_CONFIG.insights`
  70b, json, **pas de cache** car sortie créative). Grounding strict sur l'evidence.
- ClickHouse **best-effort** : si CH down/absent → pricing + positioning ne produisent
  rien (skip propre), feature + hiring tournent quand même. 2 nouveaux query helpers
  batchés (`getPricingHistorySince` / `getPricingStatusHistorySince`, `IN {ids:Array}`).
- **Idempotence** : skip un pattern déjà publié pour l'org < 7j (match sur
  `evidence.metric` stable, PAS sur le title formulé qui varie d'un run à l'autre).
- Cron **statique** lundi 7h UTC (Trigger.dev ne supporte pas de cron piloté par env) ;
  `SECTORAL_ANALYSIS_DAY` documenté mais non câblé. MIN_COMPETITORS/MIN_CONFIDENCE lues
  au runtime via worker `env.ts` (z.coerce, defaults 4 / 0.6).
- **Digest** : les sectoral_signals ne repassent PAS dans l'IA. Le job attache les
  signaux non lus/non dismissed (`digest.sectoralTrends`) après `generateDigest`, et
  `renderDigestEmail` ajoute une section séparée. Limite assumée : une semaine
  sectorielle-seule (0 signal micro) n'envoie pas d'email (skip micro conservé) — les
  signaux restent visibles sur le dashboard.

### UI
- `SectoralSignalsSection` (self-fetch `api.listSectoral`) dans `OverviewView`, section
  Card distincte "🌍 Sector trends" sous la grille des signals micro. Masquée si vide
  (pas de placeholder). Card par signal (icône catégorie, titre, insight, confidence,
  pastille non-lu, dismiss). Modal evidence (concurrents + dataPoints + metric).
  Mark-read à l'ouverture du détail, dismiss optimiste.

### Déféré (non bloquant)
- Recalibrage des seuils/confidence avec la vraie distribution (à faire après 1ers runs).
- `category_emergence` : enum présent, aucun détecteur (pas de signal clair "nouveau
  type de feature" sans NLP — hors scope pur-stats).
- Vue digest **web** non étendue (sectoralTrends rendu seulement dans l'email + dashboard).
- Email/notification sur nouveau sectoral_signal (in-app dashboard seulement).

### Runtime TODO (manuel — services + creds requis)
- Org test 5+ concurrents avec données simulant des patterns → déclencher
  `analyze-sectoral` (MCP trigger / dashboard) → vérifier sectoral_signals + evidence.
- Org < 4 concurrents → skip propre, log debug, aucun signal.
- Pricing/positioning nécessitent un historique CH réel (plusieurs scrapes/90j).
- Digest : générer après des sectoral_signals non lus → section "🌍 Sector trends".

### Vérif
`pnpm typecheck` 7/7 ✓ · `pnpm build` 7/7 ✓. `bun test` détecteurs 10/10 ✓.
`db:push` applied (table `sectoral_signals` + enum `sectoral_category`). Commits laissés
à l'utilisateur (auto-committer concurrent — a aussi ajouté du patch-14 en parallèle).

### E2E run réel (Trigger.dev MCP, dev, 2026-06-01)
`analyze-sectoral` déclenchée manuellement (run_cmpv1plmd0i9v0in9a5yzwf5h, build 20260601.20)
→ `completed` en 1.4s, output `{ orgs: 4, analyzed: 1, signals: 0 }`. Confirme le flow
complet contre la vraie DB Railway + ClickHouse : 4 orgs onboardées, 3 skip propre (<4
concurrents), 1 analysée, 0 pattern significatif (données dev éparses — attendu : pas
assez d'historique features/hiring/pricing pour franchir les seuils). Aucun crash, aucun
appel Groq (0 pattern → 0 formulate). Recalibrage seuils impossible tant qu'il n'y a pas
de vraies données denses.

### Pré-requis débloqué : logger `trigger dev`
`packages/shared/src/logger.ts` : `pino({transport:"pino-pretty"})` throwait à la
construction sous le runtime d'indexation `trigger dev` (gated `NODE_ENV=development`),
cassant l'import de TOUS les jobs en local (le worker déployé NODE_ENV=production était
épargné). Fix : `createLogger()` enveloppe le transport pretty dans un try/catch →
fallback `pino(baseOptions)`. Hors périmètre patch-13 (infra partagée) mais nécessaire
pour le trigger local ; débloque `pnpm trigger:dev` pour tout le monde. Commit laissé au user.

---

## Patch-14 — Trust & clarity (divulgation progressive) — implémenté 2026-06-01

**Décisions de cadrage (validées user) :** UI 100% anglais (les strings FR du patch
traduites — règle `language.md` override le patch) ; commits laissés à l'utilisateur
(typecheck 7/7 ✓ + build 7/7 ✓ + bun test 18/18 ✓).

### Divergences réelles vs patch (le patch invente une archi qui diverge — cf. memory)
- **`signals` n'a NI `title` NI `detectedAt`** → l'endpoint detail renvoie `insight`
  + `category` + `createdAt` (aliasé `detectedAt`). Pas de `title` inventé.
- **Classification réelle = `{category, severity, is_significant, reason}`** (le patch
  invente `type:"pricing_decrease"`). On a AJOUTÉ `humanChangeBefore/After` nullable.
- **2 chemins vers un signal** : classification générique (before/after extrait par le
  modèle) ET `pricingTransition` patch-11 (before/after dérivé des labels de statut via
  nouveau `PRICING_STATUS_LABELS` dans shared).
- **Cache patch-09 compatible** : `withAiCache` retourne l'objet stocké SANS re-valider
  → champs en `.nullable().optional()`, même clé (hash diff) → vieux cache = champs
  `undefined` (fallback gracieux), nouveau cache = champs présents.
- **`GET /competitors/:id` expose déjà `monitors` + `recentSignals`** (sourceType,
  monitorUrl, lastRunAt/lastFailedAt) → freshness par section dérivée côté web (dots sur
  les TabsTrigger), pas de changement de l'endpoint detail. Seuls `GET /` (liste, dot
  global agrégé) + le nouveau `GET /signals/:id/detail` ont touché l'API.
- **Toast = sonner** (déjà monté), PAS un `<Toast>` shadcn neuf comme le patch.
- **ErrorBoundary root = idiome Next** → `app/global-error.tsx` (html/body + styles
  inline car globals.css/theme pas montés là) + Sentry.captureException ; `dashboard/error.tsx`
  amélioré (Sentry + "Back to dashboard"). Pas de classe montée à la main.
- **Format API erreurs : envelope PLAT rétro-compatible** (`lib/errors.ts`) — `error`
  reste le code string (sinon `paywallFromError` + `ApiError.code` cassent partout), on
  AJOUTE `message/userAction/retryAfterSeconds`. PAS de format nested (aurait tout cassé).
- **Typo réelle = Bricolage Grotesque + DM Mono** (ni General Sans/Geist du design-system,
  ni Syne/Inter du web/CLAUDE.md) → `font-mono` (var), pas de nom de police hardcodé.

### Composants atomiques livrés (réutilisés)
- `shared/constants/freshness.ts` : `FRESHNESS_THRESHOLDS` + `computeFreshness` (pur) +
  `aggregateFreshness` (collapse N sources → 1 dot, stalest+failed wins) — utilisé par
  l'API liste ET la page concurrent (DRY).
- `outrival/signal-source-line.tsx` (N1, ×2 : feed + fiche) + `why-insight-panel.tsx`
  (N2, fetch `/detail` à l'ouverture, before/after en `font-mono`, fallback "Detail
  unavailable" + lien live si humanChange null) + `lib/source-labels.ts`.
- `outrival/freshness-dot.tsx` (4 niveaux, tooltip date exacte, focusable a11y, classes
  Tailwind statiques pour le JIT) — ×2 (liste + TabsTrigger fiche).
- `outrival/list-error.tsx` (réutilise `errorConfig`) — ×9 vues.
- `lib/error-helpers.ts` : `ERROR_CONFIGS` (3 parties) + `errorConfig` + `toastApiError(err,
  {title?, onRetry?})` — ×7 vues.

### Bug réel corrigé au passage
- `signals-view` + `competitors-list` + overview + activity-feed restaient en **skeleton
  infini sur erreur** (le `err` capturé via `String(e)` n'était jamais rendu, ou rendu en
  brut). Remplacé par `<ListError>` (gated sur `data===null`, retry où une fn load existe).

### Résiduels (NON faits — documentés, bornés volontairement)
- **Fuites `Error: {error}` techniques restantes** dans des **sheets/secondaires** :
  `detection-config-sheet`, `digest-settings-sheet`, `alert-channels-sheet` (sheets settings),
  `billing-dashboard`, `workspace-settings-form`. Lower-traffic, derrière des sheets. Une
  passe de conversion `<ListError>`/`toastApiError` reste à faire (même pattern mécanique).
- `outrival/digests-list.tsx` a une fuite mais **n'est importé nulle part** (mort — non touché).
- **FreshnessDot sur /my-product** (patch-12) : déféré — nécessiterait que l'API my-product
  expose la freshness par monitor self (plomberie en plus). My-product affiche déjà un
  message d'erreur propre + a ses toasts convertis.
- **Source line "adaptée" sur sectoral signals (patch-13)** : déféré — les sectoral signals
  sont multi-concurrents sans `sourceType`/`changeId` unique ; la source line micro ne
  s'applique pas tel quel.
- **Battle cards : SignalSourceLine sur signals cités** : déféré (les battle cards citent
  des insights agrégés, pas des signals individuels avec changeId).
- `ui/dialog.tsx` a un `<span className="sr-only">Fermer</span>` FR **pré-existant**
  (dette language.md hors périmètre — non touché, surgical).

### Runtime TODO (manuel — creds requis)
- Signal réel généré post-patch → vérifier `humanChangeBefore/After` peuplés (Groq) ;
  signal pré-patch → why-panel "Detail unavailable" + lien live.
- Forcer un scrape failed → pastille rouge "Last scan failed" sur la fiche + dot global.
- Couper l'API → toast `network_error` 3-parties + écran sobre, Sentry reçoit (prod).

---

# Patch 02 — Admin ops (observabilité backend) — implémenté 2026-06-01

Tour de contrôle interne. Gaté à l'**allowlist d'emails `ADMIN_EMAILS`**, JAMAIS
le role `owner` d'org (qui exposerait tous les clients). Statut : **COMPLETE**
(typecheck 7/7 ✓ · build 7/7 ✓ · ch:setup OK · db:push OK · queries CH+PG
smoke-testées sur l'instance réelle). Commits laissés à l'utilisateur.

## Divergences spec ↔ code réel (adaptées)
- `clickhouse-schema.ts` préfixe chaque DDL `${DATABASE}.` → les 2 tables ops
  suivent ce pattern (pas le snippet brut du patch).
- `scrape-monitor.job.ts` N'EST PAS linéaire (4 sorties + `onFailure`). Le snippet
  "startedAt … un seul insert" ne colle pas. → helper `logScrapeRun` appelé à
  **3 points in-run** (304 `not_modified` → no_change/proxy0 ; hash identique →
  no_change/proxy selon scrape ; succès → success) + `onFailure` → failed. Le skip
  `recent_snapshot` (garde d'idempotence, aucun fetch) n'est **pas** loggé.
- Onboarding analyze/score = **API synchrone, pas workers** → non instrumentés en
  `ai_runs`. Tasks loggées (workers) : `classify` (classify-change, modèle
  `classificationFast` 8b), `insight` (generate-signal, 70b), `digest`
  (generate-weekly-digest), `battle_card` (generate-battle-card). `analyze_product`
  / `score_overlap` restent dans l'enum CH mais sans producteur (API-side).
- Feedback gating existant = `users.role === "owner"` (route `GET /api/feedback`
  laissée intacte, surgical). L'admin a sa propre route `/api/admin/feedback*`
  gatée allowlist.
- `withAiCache` n'expose toujours pas `cached` à l'appelant (patch-09 l'avait
  différé). L'enum `ai_runs` du patch = `success|parse_failed|error` (pas de
  `cached`). → **rebranchement `cached` NON fait** : il faudrait changer la
  signature publique de `withAiCache` (footprint packages/ai) + ajouter une
  colonne hors enum. Déféré, noté ici. Conséquence : un hit de cache est compté
  comme un appel IA "success" → l'estimation de coût Groq **sur-compte** les
  appels réellement facturés (acceptable pour une tendance ; documenté côté UI
  "estimates — trends, not accounting").

## Tables (append-only)
- ClickHouse `scrape_runs` (monitor_id, competitor_id, source_type, status,
  used_proxy UInt8, duration_ms UInt32, recorded_at) — ORDER BY recorded_at.
- ClickHouse `ai_runs` (task, provider, model, status, recorded_at).
- Postgres `audit_log` (actor_email, action, target_type, target_id, metadata,
  created_at). Actions : `view_user`, `force_scrape`, `update_feedback`.

## Robustesse "ops logging ne casse jamais le scrape/l'IA"
- `logScrapeRun`/`logAiRun` = `insertBestEffort` (try/catch silencieux, jamais de
  throw, skip si CLICKHOUSE_URL absent).
- Instrumentation IA = `try { call } catch { logAiRun(error); throw }` puis
  `logAiRun(result ? success : parse_failed)`. La tâche `@outrival/ai` reste PURE
  (aucun accès DB) — c'est le job qui logge.
- `logAudit` (route admin) wrappé try/catch → un échec d'audit ne casse pas
  l'action admin.

## Seuils ops-health-check (cron `0 */6 * * *`, conservateurs, anti alert-fatigue)
Chaque alerte de taux est gatée par un échantillon minimal :
- Scraping fail > 30% / 6h (min 10 runs) → "⚠️ Scraping degraded".
- AI parse_failed > 25% / 6h (min 10 runs) → "⚠️ AI parsing degraded".
- 0 signal / 24h **MAIS** ≥20 scrape runs (sinon système idle = normal) →
  "🚨 AI pipeline silent".
- Proxy scrapes > 500 / 24h → "💸 Proxy cost rising".
- 1 seul message Slack groupé via `sendSlackMessage(OPS_SLACK_WEBHOOK_URL)` (silent
  si webhook vide). Seuils = constantes hardcodées (pas d'env, KISS).

## Estimations de coût (route `GET /api/admin/cost`, étiquetées "estimates")
- ScrapingBee : 25 crédits/scrape proxy (premium) × $49/100k crédits =
  **$0.01225/scrape proxy**.
- Groq : estimation forfaitaire mixte 8b/70b ≈ **$0.0012/appel IA** (~1.5k in +
  0.5k out). Sur-compte les hits de cache (cf. divergence `cached` ci-dessus).
- Tailles : Postgres `pg_database_size()`, ClickHouse `sum(bytes_on_disk)` sur
  `system.parts WHERE active`, **R2 = n/a** (pas d'API usage cheap → tracké à part).

## Allowlist admin
- `ADMIN_EMAILS` (csv) lu directement dans `process.env` (comme
  `OPS_SLACK_WEBHOOK_URL`), pas dans `env.ts` (vars requises au boot uniquement).
- Web : `app/(admin)/admin/page.tsx` re-vérifie la même allowlist côté serveur →
  `notFound()` (404) si non-admin. L'API re-gate **chaque** `/api/admin/*`
  (`adminMiddleware` après `authMiddleware`) → defense in depth. Allowlist vide =
  personne ne passe (safe default).

## Runtime TODO (manuel — services + creds + Trigger.dev)
- Vérifier 403 sur email hors allowlist vs accès admin OK.
- Déclencher ops-health-check en conditions dégradées → alerte Slack reçue.
- Lire un feedback avec screenshot → blob servi par `/api/admin/feedback/:id/screenshot`.
- Forcer un scrape depuis le debug user → ligne `audit_log` `force_scrape`.
- NB : au moment du smoke, `scrape_runs`/`ai_runs`/`signal_feed` contenaient déjà
  des données (runner trigger:dev local actif) → toutes les requêtes admin
  retournent des agrégats réels.
