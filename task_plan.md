# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [ ] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [ ] Phase 3 — Intelligence IA (Groq classification, Claude insights, digest)
- [ ] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [ ] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [ ] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel)
- [ ] Phase 7 — Monétisation (Stripe, free tier limits, landing page)

## Phase en cours
Phase 2 — Scraping Core (prochaine)

## Étapes session actuelle (Phase 1 — terminée)

- [x] Étape 0 — Install all deps (shared/db/api/web/workers + shadcn core)
- [x] Étape 1 — packages/shared (Result<T,E>, domain constants)
- [x] Étape 2 — packages/db (Drizzle schema 10 entités + drizzle.config.ts)
- [x] Étape 3 — apps/api (Hono + Better Auth + health endpoint + env.ts)
- [x] Étape 4 — apps/web (Next.js + auth flow + dashboard shell + design system)
- [x] Étape 5 — apps/workers (trigger.config.ts + hello-world.job.ts)
- [x] Étape 6 — Env vars (.env.local + BETTER_AUTH_SECRET généré)
- [x] Étape 7 — Vérification finale (pnpm build ✓ | pnpm typecheck ✓ 7/7)
- [x] Étape 8 — Mise à jour fichiers planning

## Décisions architecturales
- Stack : Next.js App Router + Hono/Bun + Drizzle + Railway PostgreSQL + ClickHouse
- Infra : Hetzner VPS + Coolify (self-hosted, EU)
- Scraping : Crawlee + ScrapingBee proxy
- Jobs : Trigger.dev v3 (SDK v4.4.6)
- Stockage binaire : Cloudflare R2
- Auth : Better Auth v1.6.11
- AI : Groq (classification) + Claude Sonnet (insights)

## À faire avant Phase 2

- Remplir DATABASE_URL dans .env.local (Railway PostgreSQL)
- Lancer pnpm db:push --filter @outrival/db pour migrer le schéma
- Remplir TRIGGER_SECRET_KEY + TRIGGER_PROJECT_ID dans .env.local
- Test E2E manuel : register → login → dashboard → logout

## Blockers
Aucun
