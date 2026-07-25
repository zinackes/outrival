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
         @outrival/db · @outrival/ai · @outrival/scrapers · @outrival/shared · @outrival/queue

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

## Skills tierces

Skills communautaires (MIT, PAS Anthropic) installés sélectivement dans
`.claude/skills/`, depuis deux repos distincts. **Invoquer explicitement** : ne
jamais les laisser s'auto-déclencher. Les descriptions « proactive » et les listes
« Triggers on … » de la plupart contredisent karpathy §2, ma règle prime.

### Dev workflow (repo `alirezarezvani/claude-skills`)

Aucun hook, scripts stdlib-only (`python3`, pas de `pip install`). Deux scripts
sortent de leur bac à sable : `aeo/aeo_audit.py` fait un `GET` réseau vers l'URL
passée, `aeo/citation_tracker.py` écrit un ledger dans `~/.aeo-data/`, les deux
sur invocation explicite seulement.

- **llm-cost-optimizer** — auditer/réduire le coût du pool IA (Cerebras→Groq→
  Hyperbolic), caching gpt-oss, routing par `tier`, logging `ai_runs` par feature.
- **slo-architect** — transformer les promesses de la landing (onboarding ≤5 min,
  ratio 70:1, scan horaire) en SLI/SLO/error-budget + alertes burn-rate.
- **data-quality-auditor** — profiler la qualité des extractions (`pricing_history`,
  `job_counts`, `review_scores`), missingness, score DQS avant de s'y fier.
- **prompt-governance** — versioning + evals + détection de régression sur les
  prompts de `packages/ai/src/prompts/`.
- **aeo** — optimiser le contenu pour être cité par les LLM (sert AI Visibility +
  les pages comparatives).
- **competitor-alternatives** — structurer les pages GTM « alternatives à X » / « X vs Y ».
- **programmatic-seo** — générer des pages SEO à l'échelle (templates + data).
- **schema-markup** — poser/valider le JSON-LD structuré (rich results + visibilité IA).

### Interface / design (repo `jakubkrehel/skills`)

100 % markdown : zéro script, zéro hook, rien à exécuter. Six skills sur sept
installés. `better-accessibility` est écarté, il recouvre `web-design-guidelines`
(Vercel Web Interface Guidelines, déjà là et rafraîchi à chaque run).

- **better-ui** : polish et motion. Rayon concentrique (`outer = inner + padding`),
  `scale(0.96)` au press, transitions CSS interruptibles plutôt que keyframes,
  `initial={false}` sur `AnimatePresence`, jamais `transition: all`, stroke d'icône
  aligné sur le poids du texte. C'est le plus proche de `lib/motion` et de `motion@12`.
- **better-colors** : OKLCH. `globals.css` l'est déjà de bout en bout (tokens
  `--cat-*`, `COMPETITOR_COLORS` en hue+chroma avec lightness dérivée en CSS).
  Palettes, gamut P3, `@theme` Tailwind v4, contraste APCA/WCAG, drift de teinte.
- **better-writing** : microcopy. Boutons verbe-first, une seule policy de casse,
  erreurs qui disent comment réparer, empty states. Se lit avec
  `.claude/rules/language.md` (tout le user-facing est en anglais).
- **better-typography** : échelle de type, hiérarchie de titres, `tabular-nums`,
  `text-wrap`, troncature, soulignements. Ne pas le laisser contredire la règle
  « Geist Mono = voix data uniquement, jamais de la prose ».
- **better-layout** : groupement, alignement, ordre de lecture, disclosure
  progressive, breakpoints et container queries, propriétés logiques.
- **better-interface** : orchestrateur read-only. Il lance les domaines ci-dessus
  et consolide en un seul tableau de findings + verdict (`Block` / `Needs changes` /
  `Approve`). `better-accessibility` n'étant pas installé, il rendra toujours ce
  domaine `Not reviewed` : c'est attendu, `web-design-guidelines` couvre ce terrain
  séparément.