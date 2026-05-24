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
