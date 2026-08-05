# Outrival

SaaS de veille concurrentielle — monitore automatiquement les concurrents
et génère des insights stratégiques IA via digests hebdomadaires et alertes.

@docs/architecture.md — index : domaine, stack, infra, plans. Le détail
(schéma, pipeline, env, décisions, auth) vit dans `docs/architecture/*` et se lit
**à la demande** — ne pas l'importer avec `@`, ça le remettrait dans chaque session.
@.claude/rules/karpathy.md — guidelines comportementaux obligatoires
@.claude/rules/production.md — règles prod (deploy, branches, secrets, invariants)

## Commandes

pnpm dev                        # Tous les services (web :3000, api :3001)
pnpm dev --filter @outrival/web # Web uniquement
pnpm dev --filter @outrival/api # API uniquement
pnpm build                      # Build tous les packages
pnpm typecheck                  # Typecheck tous les packages
pnpm test                       # Tests — tous les packages en parallèle (parité CI, ~3,4 Go)
pnpm test:local                 # Tests un package à la fois (~1,1 Go) — à préférer en local
pnpm test:fast                  # Tests des seuls packages touchés vs origin/main
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
         @outrival/db · @outrival/ai · @outrival/scrapers · @outrival/shared · @outrival/queue

## Routage des données — CRITIQUE

- Relationnel + time-series / analytics  → PostgreSQL (Neon) via Drizzle
- Assets binaires (HTML, screenshots)    → Cloudflare R2
- JAMAIS de snapshot HTML en PostgreSQL  → toujours R2
- Tables analytics (ex-ClickHouse)       → `packages/db/src/schema/analytics.ts`,
  append-only, écrites best-effort par les workers (`lib/analytics.ts`), lues
  best-effort par l'API (`lib/analytics-safe.ts`). Plus de ClickHouse.

## Conventions fichiers

- Handlers de jobs    → apps/workers/src/core/[name].ts (déclarés dans packages/queue/src/jobs.ts)
- Scrapers            → packages/scrapers/src/[source]/[source].scraper.ts
- Tâches IA           → packages/ai/src/tasks/[name].ts
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

## Skills tierces

Skills communautaires (MIT, PAS Anthropic) dans `.claude/skills/`. Leur
description est déjà injectée par le harness : ne sont listées ici que les choses
que cette description ne dit pas.

**Règle** : les invoquer explicitement. Ne jamais les laisser s'auto-déclencher.
Les mentions « proactive » et les listes « Triggers on … » contredisent
karpathy §2 ; ma règle prime.

Ce qu'il faut savoir avant de les lancer :

- `aeo` sort de son bac à sable : `aeo_audit.py` fait un GET réseau vers l'URL
  passée, `citation_tracker.py` écrit un ledger dans `~/.aeo-data/`. Le reste des
  skills dev-workflow est stdlib-only, sans hook. Les `better-*` sont 100 %
  markdown : rien à exécuter.
- `better-interface` orchestre les 6 domaines `better-*` (accessibilité d'abord,
  polish en dernier) et plafonne à 15 findings en `full`, 5 en `quick`. Cadrer le
  périmètre AVANT de le lancer : le web fait 90 pages et 210 composants.
- `better-typography` ne doit pas contredire la règle maison « Geist Mono = voix
  data uniquement, jamais de la prose ».
- `better-writing` se lit avec `.claude/rules/language.md` (user-facing = anglais).
- `web-design-guidelines` recoupe `better-accessibility` : le premier est une
  commande de revue qui refetch ses règles, le second un corpus chargeable.