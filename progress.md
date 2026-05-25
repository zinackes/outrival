# Progress Log — Outrival

Log chronologique des sessions de développement.

## Format

### [DATE] — [Phase] — [Durée estimée]
**Objectif** : ...
**Réalisé** :
- ...
**Fichiers modifiés** :
- ...
**Tests** : pnpm build ✓ | pnpm typecheck ✓ | tests ✓
**Prochaine session** : ...

---

## Sessions

### 2026-05-25 — Phase 1 Foundation

**Objectif** : Monorepo démarrable avec auth, DB schema, dashboard shell, Trigger.dev configuré.

**Réalisé** :
- Étape 0 : Installation de toutes les dépendances (shared/db/api/web/workers + tailwind/shadcn core)
- Étape 1 : packages/shared — Result<T,E>, SOURCE_TYPES, SIGNAL_SEVERITIES, SIGNAL_CATEGORIES
- Étape 2 : packages/db — Drizzle schema complet (10 entités : organizations, users, competitors, monitors, snapshots, changes, signals, digests, alerts, job_postings, reviews)
- Étape 3 : apps/api — Hono server + Better Auth v1.6.11 + /health endpoint + Zod env validation
- Étape 4 : apps/web — Next.js App Router + auth flow (login/register) + dashboard shell (sidebar + 3 pages vides) + dark theme amber
- Étape 5 : apps/workers — Trigger.dev v3 config + hello-world.job.ts (API corrigée : logger.log vs ctx.log)
- Étape 6 : .env.local créé avec BETTER_AUTH_SECRET généré
- Étape 7 : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7)

**Fichiers créés** :
- packages/shared/src/types/result.ts
- packages/shared/src/constants/sources.ts
- packages/db/src/schema/*.ts (11 fichiers)
- packages/db/src/client.ts + drizzle.config.ts
- apps/api/src/env.ts, lib/db.ts, lib/auth.ts, middleware/auth.ts, routes/health.ts, index.ts
- apps/web/src/lib/auth-client.ts, lib/utils.ts
- apps/web/src/app/layout.tsx, globals.css
- apps/web/src/app/(auth)/login/page.tsx, register/page.tsx
- apps/web/src/app/(dashboard)/layout.tsx, logout-button.tsx, page.tsx
- apps/web/src/app/(dashboard)/competitors/page.tsx, digests/page.tsx, alerts/page.tsx
- apps/web/next.config.ts, postcss.config.mjs
- apps/workers/trigger.config.ts, src/env.ts, src/jobs/hello-world.job.ts

**Corrections notables** :
- Trigger.dev v4 : `ctx.log` → `logger.log`, `maxDuration` requis dans config
- Better Auth v1 : `drizzleAdapter` sans schema custom, ses propres tables
- TypeScript : `@types/node` + `@types/react` requis, `lib: ["DOM"]` pour web

**Tests** : pnpm build ✓ | pnpm typecheck 7/7 ✓

**Prochaine session** :
1. Remplir DATABASE_URL dans .env.local → lancer pnpm db:push
2. Remplir TRIGGER_SECRET_KEY + TRIGGER_PROJECT_ID → tester pnpm trigger:dev
3. Test E2E manuel : localhost:3000/register → login → dashboard → logout
4. Commencer Phase 2 — Scraping Core

---

### 2026-05-25 — Phase 3 Intelligence IA

**Objectif** : Pipeline IA Groq-only de bout en bout — classify + insight + digest,
alertes Slack/email, scraping autonome (cron), digest hebdomadaire.

**Réalisé** :
- Étape 0 : Install deps (groq-sdk, @anthropic-ai/sdk, resend, @clickhouse/client)
- Étape 1 : packages/ai pipeline complet (config + provider abstrait + parse + classify + insight + digest)
- Étape 2 : organizations.{slackWebhookUrl, digestEmail, digestEnabled, alertsEnabled}
- Étape 3 : classify-change.job + generate-signal.job + insert ClickHouse signal_feed (best-effort)
- Étape 4 : scrape-monitor branché sur pipeline (trigger classify-change après création Change)
- Étape 5 : send-alert.job + lib/slack + lib/resend (Slack webhook + email HTML)
- Étape 6 : schedule-scraping.job (cron horaire, enqueue monitors due selon nextRunAt)
- Étape 7 : generate-weekly-digest.job (cron lundi 8h, idempotent par weekStart, email HTML)
- Étape 8 : Routes API /api/signals, /api/digests, /api/settings/notifications
- Étape 9 : UI — activity-feed devient signals feed, page Digests (liste + détail), page Settings
- Étape 10 : pnpm typecheck ✓ (7/7) + pnpm build ✓ (7/7)

**Fichiers créés** :
- packages/ai/src/{config,provider,env,index}.ts + lib/parse.ts + tasks/{classify,insight,digest}.ts
- apps/workers/src/jobs/{classify-change,generate-signal,send-alert,schedule-scraping,generate-weekly-digest}.job.ts
- apps/workers/src/lib/{clickhouse,slack,resend,digest-email}.ts
- apps/api/src/routes/{signals,digests,settings}.ts
- apps/web/src/components/outrival/{digests-list,notification-settings-form}.tsx
- apps/web/src/app/dashboard/settings/page.tsx

**Fichiers modifiés** :
- packages/db/src/schema/organizations.ts (4 colonnes notifications)
- apps/workers/src/jobs/scrape-monitor.job.ts (trigger classify-change après changeId créé)
- apps/api/src/index.ts (mount des nouveaux routers)
- apps/web/src/components/outrival/activity-feed.tsx (Changes → Signals)
- apps/web/src/lib/api.ts (Signal/Digest/Settings types + endpoints)
- apps/web/src/app/dashboard/digests/page.tsx (liste interactive)
- .env.local (placeholders GROQ_API_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY, CLICKHOUSE_*)

**Décisions notables** :
- Pipeline 100% Groq (llama-3.3-70b-versatile) pour Phase 3 — swap Claude futur = 1 ligne dans config
- ClickHouse best-effort (skip si non configuré) pour ne pas bloquer le dev produit
- Pattern lazy : aiEnv() + getGroq() + getClaude() pour éviter crash au démarrage workers
- Idempotence signals via check signals.changeId dans BOTH classify-change ET generate-signal
- Alerts erreurs : insert ligne alerts.error au lieu de throw (signal pas perdu si alerte échoue)
- Digest skip orgs sans signal sur la semaine (pas de digest vide)

**Tests** : pnpm build ✓ (7/7) | pnpm typecheck ✓ (7/7) | tests runtime à faire avec keys

**Prochaine session** :
1. Remplir GROQ_API_KEY + RESEND_API_KEY dans .env.local
2. pnpm db:push --filter @outrival/db (colonnes notifications)
3. (optionnel) Provisionner ClickHouse + créer table signal_feed
4. Test E2E : scraper modifié → Signal → alerte high/critical reçue
5. Déclencher generate-weekly-digest manuellement → email digest reçu
6. Commencer Phase 4 — Competitor Discovery (Exa.ai)
