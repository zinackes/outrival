# Outrival

SaaS de veille concurrentielle — monitore automatiquement les concurrents
et génère des insights stratégiques IA via digests hebdomadaires et alertes.

@docs/architecture.md — stack complète, infra, domaine métier, schéma DB
@.claude/rules/karpathy.md — guidelines comportementaux obligatoires
@.claude/rules/production.md — règles prod (deploy, branches, secrets, invariants)

## Commandes

pnpm dev                        # Tous les services (web :3000, api :3001)
pnpm dev --filter @outrival/web # Web uniquement
pnpm dev --filter @outrival/api # API uniquement
pnpm build                      # Build tous les packages
pnpm typecheck                  # Typecheck tous les packages
pnpm test                       # Tests
pnpm db:generate                # Génère une migration versionnée depuis le schéma
pnpm db:migrate                 # Applique les migrations en attente (dev + déploiement)
pnpm db:baseline                # One-shot : marque les migrations existantes appliquées (env déjà créé via push)
pnpm db:studio                  # Drizzle Studio
pnpm db:push                    # ⚠️ legacy/prototypage local seulement — voir règle ci-dessous
pnpm trigger:dev                # Runner Trigger.dev local

## Migrations DB — CRITIQUE (versionnées, plus de push en prod)

Le schéma est suivi par des **migrations versionnées** (`packages/db/migrations/`),
plus par `db:push` direct (qui causait du drift + des colonnes manquantes en prod).

- **Changer le schéma** : éditer `packages/db/src/schema/*` → `pnpm db:generate`
  (crée `NNNN_*.sql` + snapshot, à committer) → `pnpm db:migrate` (applique en local).
- **Déploiement / nouvel env** : `pnpm db:migrate` (applique tout depuis `0000`).
- **Env existant créé via push** (prod actuelle) : `pnpm db:baseline` **une fois**
  (marque les migrations déjà-appliquées sans les rejouer), puis `db:migrate`.
- `db:push` reste toléré pour du prototypage **local jetable** uniquement — jamais
  sur un env partagé : il ne laisse pas de trace versionnée.

## Règles monorepo — CRITIQUE

- TOUJOURS --filter pour les deps : pnpm add [pkg] --filter @outrival/[app]
- JAMAIS de package à la racine sauf tooling (eslint, typescript, turbo)
- JAMAIS d'import cross-apps direct — passer par @outrival/shared
- Noms : @outrival/web · @outrival/api · @outrival/workers
         @outrival/db · @outrival/ai · @outrival/scrapers · @outrival/shared

## Routage des données — CRITIQUE

- Relationnel + time-series / analytics  → PostgreSQL (Neon) via Drizzle
- Assets binaires (HTML, screenshots)    → Cloudflare R2
- JAMAIS de snapshot HTML en PostgreSQL  → toujours R2
- Tables analytics (ex-ClickHouse)       → `packages/db/src/schema/analytics.ts`,
  append-only, écrites best-effort par les workers (`lib/analytics.ts`), lues
  best-effort par l'API (`lib/analytics-safe.ts`). Plus de ClickHouse.

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

### Features ad-hoc (hors phase / patch)

Une feature envoyée « comme ça » (sans phase ni patch) doit aussi finir dans le
board si elle ajoute ou modifie de façon **notable une capacité produit**. Le gate
n'est PAS la taille du diff ni l'empreinte technique — c'est l'importance produit.

- **Signaux** (augmentent la probabilité, jamais suffisants seuls) : nouvelle
  entité / table / enum / migration · nouvelle étape de pipeline ou nouveau job ·
  nouvelle source de monitoring / route API / page user-facing · nouvelle
  dépendance externe ou env var · touche ≥2 packages de façon non triviale.
- **Skip** (pas d'item) : fix, petit changement, tweak incrémental — même s'il
  touche un enum, une colonne ou une route. Un enum/colonne/route isolé ne
  justifie rien à lui seul.
- **Flow** : en fin de tâche éligible, je **propose en 1 ligne** la création d'un
  item, tu valides — pas d'auto-création (le board reste synchro à la main).
- **Création** : item directement en `Status = Done` (pas de phase de planif),
  avec le lien `📄 docs/<fichier>.md` s'il y a un doc, après la recherche
  anti-doublon ci-dessus.