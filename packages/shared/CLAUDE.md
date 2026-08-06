# @outrival/shared

**Feuille du graphe de dépendances** : ne dépend d'aucun autre `@outrival/*`, et tout
le monde peut l'importer. C'est le seul chemin autorisé entre deux apps. Un besoin
commun à web et api atterrit ici, pas dans un import cross-app.

## Barrel obligatoire

Tout est réexporté depuis `src/index.ts`. Un fichier ajouté sans sa ligne d'export
compile très bien ici mais reste **invisible** pour les consommateurs, et l'erreur de
résolution qu'ils obtiennent ne pointe pas vers la cause.

## Source unique de vérité, ne pas dupliquer ailleurs

- `constants/plans.ts` donne `PLAN_LIMITS`, lu par le gating de l'api, l'UI web, les
  paywalls et `send-alert`. Toute limite de plan (concurrents, sources, fréquence,
  channel, features, `aiActionsPerHour`) se change **ici et nulle part ailleurs**.
- `constants/sources.ts` + `sources/catalog.ts` donnent les sources monitorables.
- `r2/keys.ts` donne la construction des clés R2, pour que workers et api dérivent
  exactement le même chemin.

## `geo/`

`dataset.generated.ts` est un dataset GeoNames **buildé offline** (`bun
scripts/build-geo-dataset.ts`) et committé. Pas de dépendance réseau au runtime : ne
pas le remplacer par un appel d'API, et le régénérer via le script plutôt que de
l'éditer à la main.

## Tests

Colocalisés (`src/**/*.test.ts`, exclus du tsconfig) :
`pnpm test:local --filter @outrival/shared`. Une grosse part de la logique de diff,
de pricing et de scoring vit ici et se teste ici sans DB, c'est l'endroit le moins
cher pour ajouter un test.
