# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [x] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [ ] Phase 3 — Intelligence IA (Groq classification, Claude insights, digest)
- [ ] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [ ] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [ ] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel)
- [ ] Phase 7 — Monétisation (Stripe, free tier limits, landing page)

## Phase en cours
Phase 3 — Intelligence IA (prochaine)

## Étapes session actuelle (Phase 2 — terminée)

- [x] Étape 0 — Deps + R2 env (crawlee, playwright, aws-sdk, diff, date-fns)
- [x] Étape 1 — Client R2 (packages/shared/src/r2/client.ts)
- [x] Étape 2 — Diff engine (packages/shared/src/diff)
- [x] Étape 3 — Scrapers homepage/pricing/blog (Playwright + Cheerio)
- [x] Étape 4 — scrape-monitor.job (R2 upload → snapshot → diff → change)
- [x] Étape 5 — Routes API competitors/monitors/changes (auth + Zod)
- [x] Étape 6 — UI competitors + activity feed (page liste, page détail, feed)
- [x] Étape 7 — Vérif typecheck + build (7/7 ✓)
- [x] Étape 8 — Mise à jour fichiers planning

## Décisions architecturales
- Stack : Next.js App Router + Hono/Bun + Drizzle + Railway PostgreSQL + ClickHouse
- Infra : Hetzner VPS + Coolify (self-hosted, EU)
- Scraping : Crawlee + ScrapingBee proxy (Phase 2 : sans proxy, ScrapingBee Phase 5+)
- Jobs : Trigger.dev v3 (SDK v4.4.6, export `/v3`)
- Stockage binaire : Cloudflare R2
- Auth : Better Auth v1.6.11
- AI : Groq (classification) + Claude Sonnet (insights)
- Pattern multi-tenant : `ensureUserOrg(userId)` crée une org perso au premier accès

## À faire avant Phase 3

- Remplir les creds R2 dans .env.local (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
- Créer le bucket `outrival-snapshots` sur Cloudflare R2
- Test E2E manuel : ajouter linear.app → Scraper maintenant → vérifier R2 + DB + feed
- Remplir GROQ_API_KEY + ANTHROPIC_API_KEY dans .env.local

## Blockers
Aucun (creds R2 à fournir pour test E2E)
