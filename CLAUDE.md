# Outrival

SaaS de veille concurrentielle — monitore automatiquement les concurrents
et génère des insights stratégiques IA via digests hebdomadaires et alertes.

@docs/architecture.md — stack complète, infra, domaine métier, schéma DB
@.claude/rules/karpathy.md — guidelines comportementaux obligatoires

## Commandes

pnpm dev                        # Tous les services (web :3000, api :3001)
pnpm dev --filter @outrival/web # Web uniquement
pnpm dev --filter @outrival/api # API uniquement
pnpm build                      # Build tous les packages
pnpm typecheck                  # Typecheck tous les packages
pnpm test                       # Tests
pnpm db:push                    # Push schema Drizzle → Railway Postgres
pnpm db:migrate                 # Migrations en attente
pnpm db:studio                  # Drizzle Studio
pnpm trigger:dev                # Runner Trigger.dev local

## Règles monorepo — CRITIQUE

- TOUJOURS --filter pour les deps : pnpm add [pkg] --filter @outrival/[app]
- JAMAIS de package à la racine sauf tooling (eslint, typescript, turbo)
- JAMAIS d'import cross-apps direct — passer par @outrival/shared
- Noms : @outrival/web · @outrival/api · @outrival/workers
         @outrival/db · @outrival/ai · @outrival/scrapers · @outrival/shared

## Routage des données — CRITIQUE

- Données relationnelles structurées    → PostgreSQL (Railway) via Drizzle
- Time-series / analytics               → ClickHouse Cloud
- Assets binaires (HTML, screenshots)   → Cloudflare R2
- JAMAIS de snapshot HTML en PostgreSQL → toujours R2
- JAMAIS de time-series en PostgreSQL   → toujours ClickHouse

## Conventions fichiers

- Jobs Trigger.dev    → apps/workers/src/jobs/[name].job.ts
- Scrapers            → packages/scrapers/src/[source]/[source].scraper.ts
- Prompts AI          → packages/ai/src/prompts/[name].prompt.ts
- Schema DB           → packages/db/src/schema/[entity].ts
- Routes API          → apps/api/src/routes/[resource].ts

## Notion — roadmap produit

Roadmap produit = database Notion "🎯 Roadmap" (sous le hub "Outrival").
À tenir synchro à la main (la roadmap dérive sinon, cf. statuts tous restés "Now") :

- Une phase / patch / feature de la roadmap **développée** (code implémenté,
  typecheck/build OK — pas besoin d'attendre merge `main` ni déploiement) →
  passer son `Status` à `Done` dans Notion.
- Le suivi "réellement en prod" (mergé + déployé) sera tracké séparément
  (mécanisme à définir — TODO). Ne pas l'attendre pour passer un item `Done`.
- Un doc de specs / réflexion écrit dans `docs/` pour un item de la roadmap →
  le référencer dans la note Notion de l'item : `📄 docs/<fichier>.md (existe déjà)`.
- Avant de créer un item : chercher dans la data source pour éviter un doublon
  (l'énumération par search sémantique n'est pas exhaustive — vérifier le titre).