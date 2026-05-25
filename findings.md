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

## Décisions de design

- Outrival = dark theme, amber (#F59E0B), Syne + Inter
- shadcn/ui new-york style, radius 6px, flat surfaces
- CSS custom properties pour toutes les couleurs (--background, --surface, --accent, etc.)
- Logo : "Out" blanc + "rival" amber, font Syne
