# Outrival

SaaS de veille concurrentielle : monitore des concurrents, génère des insights IA.

@docs/architecture.md : index. Le détail vit dans `docs/architecture/*` et se lit à
la demande. Ne pas l'importer avec `@`, ça le remettrait dans chaque session.
@.claude/rules/karpathy.md
@.claude/rules/production.md

## Carte du monorepo (lire le `CLAUDE.md` du package avant d'y toucher)

| Package | Tu y vas quand… |
|---|---|
| `apps/web` | page, composant, design system |
| `apps/api` | route HTTP, auth, gating de plan (enqueue seul, jamais un handler) |
| `apps/workers` | corps d'un job, cron, orchestration d'un scrape |
| `packages/db` | table, colonne, enum, migration |
| `packages/ai` | prompt, tâche IA, grounding |
| `packages/scrapers` | source de données, cascade de collecte |
| `packages/queue` | déclarer un job : retry, expire, concurrence |
| `packages/shared` | type / constante / util partagé (dont `PLAN_LIMITS`) |

## Valider un changement

```bash
pnpm typecheck                           # LE gate : il n'y a aucun linter dans ce repo
pnpm test:local --filter @outrival/api   # tests, un package à la fois (~1,1 Go)
pnpm test:fast                           # seulement les packages touchés vs origin/main
```

`pnpm test` (tout en parallèle, ~3,4 Go) reproduit la CI mais fait OOM la VM WSL2,
`pnpm build` aussi. Ne pas les lancer pour vérifier : `typecheck` suffit.

## Travailler dans un worktree

- `bun test` depuis la racine **sort en 1** : il charge tous les packages dans un
  seul process. Passer par `pnpm test:local --filter`, ou `cd` dans le package.
- `.worktreeinclude` recopie les `.env*` gitignorés dans un worktree neuf. Y lancer
  `pnpm install`, sinon les `@outrival/*` résolvent le code de `main`.

## Interdits

- `pnpm add` sans `--filter @outrival/<pkg>` : la racine ne porte que du tooling.
- Import cross-apps direct. Passer par `@outrival/shared`.
- Snapshot HTML en Postgres. Les assets binaires vont sur R2.
- `prettier --write` : aucune config dans le repo, il reformaterait tout.
- Commit hors Conventional Commits (`feat|fix|refactor|docs|test|chore`, sujet ≤ 50
  car., description qui dit le *pourquoi*, pas le *quoi*).

## Roadmap Notion

Database « 🎯 Roadmap », tenue à la main. Une phase / patch / feature **développée**
(code + typecheck OK, sans attendre le merge) passe en `Status = Done`. Une feature
ad-hoc notable : proposer l'item en 1 ligne, l'utilisateur valide, jamais d'auto-création.

## Skills tierces (`.claude/skills/`, MIT, pas Anthropic)

Les invoquer **explicitement**, jamais en auto-déclenchement malgré leurs mentions
« proactive ». `aeo` sort du bac à sable (GET réseau, écrit dans `~/.aeo-data/`).
Cadrer le périmètre avant `better-interface` : le web fait 90 pages.
