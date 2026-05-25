# Findings — Outrival

Découvertes techniques et décisions importantes accumulées au fil des sessions.

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
