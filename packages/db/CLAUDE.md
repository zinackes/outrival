# @outrival/db

Drizzle + PostgreSQL (Neon). Schema et queries uniquement, aucune logique métier ici.

## Migrations versionnées

`pnpm db:generate` écrit dans **`packages/db/migrations/`** (le `out` de
`drizzle.config.ts`), pas dans `src/migrations/` qui ne contient qu'un script
one-shot legacy. Committer le `.sql` **et** le snapshot.

- Cycle : éditer `src/schema/*`, puis `db:generate`, puis `db:migrate` (local).
- `db:push` est **interdit** sur un env partagé : il ne laisse aucune trace
  versionnée, et c'est ce qui a produit du drift plus des colonnes manquantes en
  prod. Toléré pour du prototypage local jetable.
- Avant tout `db:migrate` sur un env partagé : `db:preflight` pour lister le
  PENDING. Une migration antidatée ou dont le hash a dérivé est **sautée en
  silence** par le journal drizzle, en affichant un message de succès.
- Prod : `db:migrate:deploy` (migrator runtime `src/migrate.ts`), jamais drizzle-kit
  dans l'image.

## Conventions

- Un fichier par entité dans `src/schema/[entity].ts`.
- Exporter le type inféré (`export type X = InferSelectModel<typeof xTable>`) **dès
  qu'un consommateur nomme la ligne** — signature de fonction, prop de composant,
  payload de job. 30 des 55 fichiers de schéma le font ; les 25 autres (`changes`,
  `signals`, `competitors`, `monitors`, `snapshots`, `organizations`, `users`,
  `auth`…) n'ont que des consommateurs qui lisent le type inféré du `db.query`, et
  un alias posé d'avance ne ferait qu'ajouter un nom de plus à garder synchrone.
- Jamais de SQL manuel hors migration.

## Analytics (`src/schema/analytics.ts`)

Ex-ClickHouse, rapatrié dans la même base Neon. Tables **append-only, sans FK** :
c'est du logging best-effort, écrit par `apps/workers/src/lib/analytics.ts` et lu
par `apps/api/src/lib/analytics-safe.ts`, qui renvoie `[]` sur n'importe quelle
erreur. Une requête analytics ne doit jamais pouvoir casser un handler de route :
ne pas ajouter de FK ni de contrainte qui rendrait une écriture bloquante.
