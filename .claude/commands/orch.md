---
description: Lance et supervise une orchestration Orca multi-agents sur une feature
argument-hint: [description de la feature]
disable-model-invocation: true
---

Orchestre $ARGUMENTS via Orca. Tu es le **coordinateur** : tu ne codes pas, tu
découpes, tu lances, tu supervises, tu me remontes les questions.

Si $ARGUMENTS est vide : demande la feature en une ligne et arrête-toi là.

## 0. Pré-requis (silencieux, 1 appel)

```bash
orca status --json   # runtime.state doit être "ready"
echo $ORCA_TERMINAL_HANDLE   # non vide = ce terminal peut être coordinateur
```

Si `ORCA_TERMINAL_HANDLE` est vide, dis-le et arrête : il faut lancer Claude
depuis un terminal Orca. Toujours vérifier `"ok": true` dans la réponse JSON,
jamais seulement l'exit code (un no-op renvoie `ok:false` / `runtimeId:null`).

## 1. Découper

Explore le code concerné (CodeGraph d'abord), puis découpe en **2 à 4 tasks
d'implémentation à scopes de fichiers disjoints** + **1 task de review** qui
dépend de toutes les autres.

Répartition par défaut :

| Rôle | Agent | Pourquoi |
|---|---|---|
| Implémentation | `codex` | quota séparé du mien, convention de branche `codex/out-NN-*` |
| Review de la diff | `claude --model opus --effort high` | court, un seul passage sur mon quota 5h |
| Recherche / copy en amont | Hermes, **hors DAG** | pas un agent Orca connu ; il livre dans `~/outrival-ops/`, on cite le fichier dans la spec |

Deux workers ne doivent jamais toucher le même fichier. Si le découpage ne
donne pas de scopes disjoints, dis-le et propose un worktree par worker
(`--worktree new-child --name <nom> --setup run`) au lieu de `current`.

## 2. Proposer, puis ATTENDRE

Affiche le plan en un tableau `task | agent | scope | gate`, plus une estimation
de durée. **N'exécute rien avant mon « go ».**

## 3. Lancer

Écris chaque spec dans le scratchpad puis passe-la inline (les flags orca qui
prennent un *chemin* résolvent côté Windows, `"$(cat …)"` est une expansion
shell et passe donc bien) :

```bash
orca orchestration run-create --objective "<feature>" --json
orca orchestration task-create --spec "$(cat <scratch>/spec-a.md)" --json
orca orchestration task-create --spec "$(cat <scratch>/spec-b.md)" --json
orca orchestration task-create --spec "$(cat <scratch>/spec-review.md)" \
  --deps '["<task_a>","<task_b>"]' --json
orca orchestration worker-start --task <task_a> --worktree current --agent codex --json
orca orchestration worker-start --task <task_b> --worktree current --agent codex --json
```

Toutes les tasks d'abord, tous les workers indépendants ensuite, et seulement
après on attend. Lis le receipt de `worker-start` : `ready` + setup `running`
est normal. Un exit non nul → inspecte `stage`/`effects`, ne relance pas en
aveugle.

### Template de spec (obligatoire, les 4 lignes)

```
OBJECTIF: <une phrase>
SCOPE: <globs>. Ne touche AUCUN autre fichier.
GATE: pnpm typecheck && pnpm check:lint && pnpm test:local --filter @outrival/<pkg>
RUNTIME: tout texte visible utilisateur ou envoyé à un modèle est en anglais.
BLOQUÉ: orca orchestration ask --question "…" --options "a,b" --timeout-ms 600000 --json
        N'invente pas, attends la réponse.
FINI: orca orchestration send --type worker_done --subject "<statut>" \
      --body "<fait / trouvé / reste>" --task-id <id> --dispatch-id <id> \
      --outcome succeeded --files-modified "a,b" --json
```

## 4. Superviser

```bash
orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

Boucle jusqu'à ce que **tous** les dispatches soient settled :

1. `question` → si tu sais répondre, réponds. Sinon remonte-la-moi en une ligne
   et attends, puis `orca orchestration reply --id <msg_id> --body "…" --json`.
2. `worker_done` → `orca orchestration worker-release --dispatch <id> --json`.
3. Ack seulement après avoir traité **tous** les messages du batch :
   `check --ack <delivery_id> --wait --types … --timeout-ms 900000 --json`.
4. Quand les tasks d'implémentation sont `completed` : `task-list --ready --json`,
   puis `worker-start` la review sur `claude --model opus --effort high`.
5. Un timeout ou `{count:0}` n'est **pas** un échec. Une task de code tourne 15
   à 60 min. Ne stoppe jamais un worker parce qu'il n'a pas encore répondu.

Entre deux attentes, dis-moi en une ligne où on en est (`task-list --brief --json`).

## Pièges

- Un worker ne peut pas dispatcher de sous-worker (`nested_worker_depth_exceeded`).
  Il doit finir lui-même.
- Ne jamais `terminal close` à la place de `worker-release`.
- `dispatch --inject` sur un terminal ouvert à la main reste *unsupervised* :
  `worker-stop`/`worker-release` ne le fermeront pas.
- Pas de push, pas de PR, pas de merge sans mon go explicite.

## Rendu final

Un tableau `task | outcome | fichiers modifiés`, les findings de la review, et
**une** prochaine action concrète.
