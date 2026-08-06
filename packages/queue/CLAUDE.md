# @outrival/queue

pg-boss v12. Source unique de vérité des jobs, importée par l'api (**enqueue seul**)
et par les workers (enqueue + work + cron). Le corps des handlers vit dans
`apps/workers/src/core/`, jamais ici.

## Déclarer un job : `src/jobs.ts`

`defineJob<Payload>(name, config)`. Le type de payload doit refléter l'`InputSchema`
zod du handler : une dérive n'est pas rattrapée à la compilation, elle explose au
parse **sur le worker en prod**.

Défauts appliqués si `config` ne dit rien : `policy: "standard"`, `retryLimit: 2`
(soit 3 tentatives), `retryBackoff: true`, `expireInSeconds: 300`,
`deleteAfterSeconds: 7j`, `notify: true`.

⚠️ **`boss.createQueue()` est create-IF-NOT-EXISTS.** Changer les `queueOptions`
d'un job déjà déployé n'a **aucun effet** sur cet environnement : la queue garde les
options qu'elle avait à sa création. Le nouveau réglage ne s'applique qu'aux
environnements neufs ; sur un env existant il faut une intervention explicite côté
box queue.

## Erreurs

- Échec transitoire : `throw` normal, pg-boss réessaie selon `retryLimit`.
- Échec métier ou terminal : `throw new NonRetriable("raison")`, complété sans retry.
  Le wrapper `work()` le détecte par `instanceof`, donc une erreur maison qui n'en
  hérite pas sera réessayée 3 fois.
- Retries épuisés : le job atterrit dans `outrival-dlq`.

## Pas de tests ici

Ce package n'a **pas de script `test`** : `turbo test` le saute en silence. Une
régression sur `boss.ts` ou `jobs.ts` ne se voit qu'à travers les tests des workers.

## Validation

`pnpm typecheck --filter @outrival/queue` (`build` est un `tsc --noEmit`).
