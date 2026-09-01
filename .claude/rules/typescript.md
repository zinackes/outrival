# TypeScript (.ts, .tsx)

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
