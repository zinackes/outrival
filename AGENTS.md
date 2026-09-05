# Outrival

SaaS de veille concurrentielle : monitore des concurrents, génère des insights IA.
Source unique des règles agent. `CLAUDE.md` importe ce fichier, ne pas dupliquer.

`docs/architecture.md` est un **index** ; le détail vit dans `docs/architecture/*` et
se lit à la demande, jamais importé en bloc.

Session ouverte depuis un ticket Linear (worktree `OUT-NN` ou branche `*/out-NN-*`) :
lire `.claude/docs/linear-workflow.md` **avant** de choisir plan mode ou exécution
directe.

## Carte du monorepo

Lire le `CLAUDE.md` du package avant d'y toucher.

| Package | Tu y vas quand… | Peut importer |
|---|---|---|
| `apps/web` | page, composant, design system | `shared` |
| `apps/api` | route HTTP, auth, gating de plan | `db`, `ai`, `shared`, `queue` (enqueue seul), `scrapers` (sous-chemins `quick-fetch`, `pricing`, `positioning`, `discovery`) |
| `apps/workers` | corps d'un job, cron, orchestration d'un scrape | `db`, `ai`, `scrapers`, `shared`, `queue` |
| `packages/db` | table, colonne, enum, migration | — |
| `packages/ai` | prompt, tâche IA, grounding | — |
| `packages/scrapers` | source de données, cascade de collecte | `shared` |
| `packages/queue` | déclarer un job : retry, expire, concurrence | — |
| `packages/shared` | type / constante / util partagé (dont `PLAN_LIMITS`) | — |

Jamais `web → api`, `api → workers`, `workers → web`, `web → queue`. Un nouveau
script passe par `turbo.json` avant d'être utilisé.

## Valider un changement

```bash
pnpm typecheck                           # gate 1 — la CI le rejoue
pnpm check:lint                          # gate 2 — oxlint, ~100 ms sur tout le repo
pnpm test:local --filter @outrival/api   # tests, un package à la fois (~1,1 Go)
pnpm test:fast                           # seulement les packages touchés vs origin/main
```

Le script s'appelle `check:lint` et **pas** `lint` : le hook RTK réécrit `pnpm lint`
en `rtk lint`, qui meurt en OOM tout en renvoyant 0, soit un gate vert à tort.

`.oxlintrc.json` ne met en **erreur** que `no-unsafe-optional-chaining` (hors tests).
Le reste sort en warning : 81 aujourd'hui, surtout des imports morts. Les nettoyer est
un chantier à part, pas un prérequis pour passer le gate.

`pnpm test` (tout en parallèle, ~3,4 Go) reproduit la CI mais fait OOM la VM WSL2,
`pnpm build` aussi. Ne pas les lancer pour vérifier : `typecheck` suffit.

## Worktrees

- `bun test` depuis la racine **sort en 1** : il charge tous les packages dans un
  seul process. Passer par `pnpm test:local --filter`, ou `cd` dans le package.
- `.worktreeinclude` recopie les `.env*` gitignorés dans un worktree neuf. Y lancer
  `pnpm install`, sinon les `@outrival/*` résolvent le code de `main`.

## Interdits

- `pnpm add` sans `--filter @outrival/<pkg>` : la racine ne porte que du tooling
  (typescript, oxlint, turbo, `@types/*`).
- Import cross-apps direct. Passer par `@outrival/shared`.
- Snapshot HTML en Postgres. Les assets binaires vont sur R2.
- `prettier --write` : aucune config dans le repo, il reformaterait tout.
- Commit hors Conventional Commits.

## TypeScript (.ts, .tsx)

- `strict` et `noUncheckedIndexedAccess` à true partout, jamais désactivés. Pas de
  `@ts-ignore` ni `@ts-expect-error` sans commentaire qui explique.
- ES modules uniquement, jamais `require()`. Default export réservé aux composants
  React et aux pages Next.js. Alias `@/` pour `src/`.
- Zod pour toute donnée externe (input API, env, sortie de scraping), types inférés
  via `z.infer`. Types Drizzle via `InferSelectModel` / `InferInsertModel`. Pas de
  `any` : `unknown` + type guard.
- Erreurs : `throw` dans la couche métier (pg-boss retry, les handlers Hono
  catchent) ; à la frontière HTTP, réponse `{ data, error }` avec code structuré,
  jamais un throw nu qui remonte au client. `Result<T, E>`
  (`packages/shared/src/types/result.ts`) reste une option locale, pas une
  obligation transverse. Loguer avec contexte : `logger.error({ err, context })`.
- **Commentaires sobres.** Ne pas commenter une constante, variable ou fonction
  dont le rôle est évident à la lecture du code. Un commentaire explique un
  *pourquoi* non évident, un invariant important, un piège ou un compromis — il ne
  paraphrase jamais le code. Éviter les blocs de plusieurs lignes quand une phrase
  suffit.

## Runtime : anglais uniquement

Tout ce qui est visible par un utilisateur ou consommé par un modèle est en
anglais : copy web (labels, toasts, empty states, `aria-label`), prompts de
`packages/ai` **et** l'instruction explicite « Write all text values in English. »
dans chaque prompt qui rend du texte libre, emails Resend, notifications in-app,
PDF (`lang="en"`, `toLocaleDateString("en-US", …)`), et les valeurs d'enum
persistées qui remontent à l'écran (`temperature` = `low | moderate | high`).

Un prompt écrit en français rend du français. Toute nouvelle vue, prompt, email ou
export est anglais dès le premier commit. Le code, les identifiants, les commits et
`docs/` sont en anglais ; cette section parle du runtime.

## Git

- Commiter à chaque unité de travail terminée (une feature, un fix, un refactor qui
  typecheck), sans attendre qu'on le redemande. Pas de gros commit fourre-tout en
  fin de session.
- Toujours `git add -A`. Jamais de cherry-pick manuel de fichiers : des fichiers non
  liés qui traînent sont le signe qu'il fallait commiter plus tôt, on committe quand
  même tout et on repart propre.
- Conventional Commits stricts (`feat|fix|refactor|docs|test|chore`), sujet à
  l'impératif de 50 caractères max, description qui dit le *pourquoi*.

## Production

Prod = OVH VPS + Coolify (web, api) et Netcup (workers, queue pg-boss), DB Neon.
Détail dans `docs/deployment.md` (matrice d'env, pré-requis, smoke test).

**Branches.** `main` = SOURCE DE PROD, Coolify auto-déploie : toujours releasable,
typecheck + test + build verts avant tout merge. `staging` = miroir pré-prod (cible,
pas encore provisionné) avec sa branche Neon, sa queue et ses clés Stripe test. Les
features partent de `main`, jamais d'une branche `patch-*`, et se mergent par PR.

**Actions outward-facing : go explicite obligatoire.** Jamais sans validation de
l'utilisateur : `git push origin main`/`staging`, deploy Coolify, restart d'un
worker, migration sur un env partagé, changement Stripe/webhook. L'assistant
propose, l'utilisateur valide. La frontière est le déploiement, pas la visibilité :
se font donc directement, sans gate, le push d'une branche de travail (`OUT-NN`,
`feat/*`, `fix/*`, `chore/*`, `zinacke/*`) y compris `--force-with-lease` sur la
sienne, ouvrir/mettre à jour/commenter une PR vers `main`, et les écritures Linear
du workflow ticket. Un « go » couvre toute la chaîne de publication qui suit (push,
PR, Linear), pas seulement la commande proposée juste avant.

**DB et migrations.** Versionnées uniquement (`db:generate` puis `db:migrate`) ;
`db:push` INTERDIT sur un env partagé. Nouvelle migration : staging d'abord, backup
prod avant toute migration non triviale. Prod = pré-deploy `db:migrate:deploy`
(migrator runtime), jamais drizzle-kit dans l'image prod.

**Secrets et env.** Jamais de secret committé. Nouvelle var : `.env.example` +
`docs/architecture/env.md`. Les `NEXT_PUBLIC_*` sont build-time, donc passés en
build args Docker. Isolation par env : clés Stripe distinctes, branche Neon,
`QUEUE_DATABASE_URL` dédiée, bucket R2. Les env boot-bloquants en prod (Upstash via
le superRefine de `env.ts`) le restent.

**Invariants à ne pas régresser.** Cookie cross-sous-domaine (`AUTH_COOKIE_DOMAIN`)
et liste d'origines CORS (`apps/api/src/index.ts`) couvrant toute origine web prod.
`/health` sans auth (sonde Coolify). Routes SSE avec `X-Accel-Buffering: no`.
Binaire Playwright Chromium vérifié sur le worker `WORKER_ROLE=browser` après chaque
deploy. Avant un go-live : dérouler le smoke test de `docs/deployment.md`.

## Comportement

Ces guidelines biaisent vers la prudence plutôt que la vitesse. Sur une tâche
triviale, utiliser le jugement.

1. **Réfléchir avant de coder.** Énoncer les assumptions. Si plusieurs
   interprétations existent, les présenter au lieu de choisir en silence. Si une
   approche plus simple existe, le dire. Si quelque chose est flou, s'arrêter,
   nommer ce qui est confus, demander.
2. **Simplicité d'abord.** Le code minimum qui résout le problème, rien de
   spéculatif : pas de feature au-delà du demandé, pas d'abstraction pour du code à
   usage unique, pas de configurabilité non demandée, pas de gestion d'erreur pour
   un scénario impossible. Si tu écris 200 lignes et que 50 suffisent, réécrire.
3. **Changements chirurgicaux.** Ne toucher que le nécessaire. Ne pas « améliorer »
   le code adjacent, les commentaires ou le formatage ; ne pas refactorer ce qui
   n'est pas cassé ; respecter le style existant. Supprimer les imports et variables
   que TES changements ont rendus inutilisés, mentionner le code mort préexistant
   sans le supprimer. Le test : chaque ligne modifiée trace directement vers la
   demande.
4. **Exécution pilotée par le but.** Transformer la tâche en critère vérifiable
   avant de commencer : « ajouter de la validation » devient « écrire les tests des
   inputs invalides, puis les faire passer » ; « corriger le bug » devient « un test
   qui le reproduit, puis qui passe ». Pour du multi-étapes, énoncer un plan bref où
   chaque étape porte son check.

## Terminal

- **RTK** réécrit git/test/build/lint automatiquement, ne pas le préfixer à la main.
  `rtk read <file>` (ou `-l aggressive` pour les signatures seules) et
  `rtk grep "<pattern>"` pour lire ou chercher dans le shell. `rtk gain` pour les
  économies, `rtk proxy <cmd>` pour court-circuiter le filtrage.
- **CodeGraph** (dossier `.codegraph/` présent) : un seul outil, `codegraph_explore`
  (question en langage naturel ou noms de symboles). Il rend la source verbatim
  numérotée, le chemin d'appels et le blast radius en un appel, y compris les sauts
  de dispatch dynamique que grep ne suit pas. L'appeler AVANT de lire des fichiers,
  et pendant l'écriture d'un patch. Pas de grep/glob/read massif d'exploration quand
  il est disponible, ni de délégation de l'exploration à un sous-agent : l'index est
  déjà construit.
- Fichier précis connu (donné par CodeGraph ou par l'utilisateur) → lecture directe.
  Dossier de code inconnu → CodeGraph. Non-code (README, `.env.example`, configs) →
  lecture directe.

## Sous-agents et skills

Lecture, grep, scaffolding, tests unitaires simples, migration triviale → `haiku`.
Implémentation, refactor, tests → `sonnet`. Décision d'architecture, revue de
design, problème complexe → `opus`. Toujours les alias, jamais un id daté.

Skills tierces (`.claude/skills/`, MIT, pas Anthropic) : les invoquer
**explicitement**, jamais en auto-déclenchement malgré leurs mentions
« proactive ». `aeo` sort du bac à sable (GET réseau, écrit dans `~/.aeo-data/`).
Cadrer le périmètre avant `better-interface` : le web fait 90 pages.
