# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [ ] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [ ] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [ ] Phase 3 — Intelligence IA (Groq classification, Claude insights, digest)
- [ ] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [ ] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [ ] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel)
- [ ] Phase 7 — Monétisation (Stripe, free tier limits, landing page)

## Phase en cours
Aucune — projet non démarré

## Étapes session actuelle
Aucune

## Décisions architecturales
- Stack : Next.js App Router + Hono/Bun + Drizzle + Railway PostgreSQL + ClickHouse
- Infra : Hetzner VPS + Coolify (self-hosted, EU)
- Scraping : Crawlee + ScrapingBee proxy
- Jobs : Trigger.dev v3
- Stockage binaire : Cloudflare R2
- Auth : Better Auth
- AI : Groq (classification) + Claude Sonnet (insights)

## Blockers
Aucun