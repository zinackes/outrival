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

Quatre issues, dans l'ordre où le wrapper `work()` les teste :

- Échec transitoire : `throw` normal, pg-boss réessaie selon `retryLimit`.
- Échec métier ou terminal : `throw new NonRetriable("raison")`, complété sans retry.
  Le wrapper le détecte par `instanceof`, donc une erreur maison qui n'en hérite pas
  sera réessayée 3 fois.
- Échec terminal **et anormal** : `throw new DeadLetter(reason, message)` (construit
  par `apps/workers/src/lib/classify-errors.ts`) — le payload est posté dans la
  dead-letter queue du job, puis le job est complété. Sans `deadLetter` déclaré il
  n'y a nulle part où le garer : il retombe sur la politique de retry normale.
- Ressource indisponible pour un moment (pool IA rate-limité) : le
  `deferralResolver` passé à `startQueue()` (`resolveAiDeferral` côté workers) rend
  un nombre de secondes, et `work()` ré-enfile le job avec `startAfter` au lieu de
  brûler ses tentatives dans la fenêtre encore throttlée. `priority` et
  `singletonKey` sont recopiés depuis `JobWithMetadata`, la sortie est
  `{ deferred: true, seconds, attempt, reason }` (`DeferredOutput`), et un compteur
  caché dans le payload borne le total à `QUEUE_MAX_DEFERRALS` (3 par défaut) :
  au-delà, l'erreur repart sur le retry normal.

⚠️ **Retries épuisés ≠ `outrival-dlq`.** Seuls 5 jobs sur 53 déclarent
`deadLetter` (`scrape-monitor`, `classify-change`, `generate-signal`,
`verify-signal-delta`, `send-alert`). Pour tous les autres, un job à bout de retries
finit `failed` dans `pgboss.job` : rien ne le rejoue et personne n'est prévenu.

## Pas de tests ici

Ce package n'a **pas de script `test`** : `turbo test` le saute en silence. Une
régression sur `boss.ts` ou `jobs.ts` ne se voit qu'à travers les tests des workers.

## Validation

`pnpm typecheck --filter @outrival/queue` (`build` est un `tsc --noEmit`).
