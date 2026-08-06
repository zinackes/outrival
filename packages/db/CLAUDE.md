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
- Toujours exporter le type inféré :
  `export type X = InferSelectModel<typeof xTable>`.
- Jamais de SQL manuel hors migration.

## Analytics (`src/schema/analytics.ts`)

Ex-ClickHouse, rapatrié dans la même base Neon. Tables **append-only, sans FK** :
c'est du logging best-effort, écrit par `apps/workers/src/lib/analytics.ts` et lu
par `apps/api/src/lib/analytics-safe.ts`, qui renvoie `[]` sur n'importe quelle
erreur. Une requête analytics ne doit jamais pouvoir casser un handler de route :
ne pas ajouter de FK ni de contrainte qui rendrait une écriture bloquante.
