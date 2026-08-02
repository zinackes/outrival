# Conventions TypeScript — Outrival

S'applique à tous les fichiers .ts et .tsx.

## Config

- strict: true dans tous les tsconfig.json — ne jamais désactiver
- noUncheckedIndexedAccess: true
- Pas de // @ts-ignore ni // @ts-expect-error sans commentaire explicatif

## Imports

- ES modules uniquement : import/export — jamais require()
- Pas de default export sur les utils et services
- Default export autorisé uniquement sur les composants React et les pages Next.js
- Chemins : utiliser les alias configurés (@/ pour src/)

## Types

- Zod pour la validation des données externes (API inputs, env vars, scraping output)
- Infer les types depuis les schémas Zod : type X = z.infer<typeof XSchema>
- Pas de any — utiliser unknown + type guard si le type est incertain
- Types Drizzle : utiliser InferSelectModel et InferInsertModel

## Gestion d'erreurs

- Couche métier / lib : `throw` en cas d'échec (pg-boss gère les retries des jobs ;
  les handlers Hono catchent au niveau route). Ne pas swallow silencieusement
  une erreur.
- Frontière HTTP (routes Hono) : réponse `{ data, error }` — jamais de throw naked
  qui remonte au client (cf. `apps/api/CLAUDE.md`). Codes d'erreur structurés pour
  le gating.
- `Result<T, E>` (`packages/shared/src/types/result.ts`) : option locale pour un
  helper feuille où un échec typé est plus lisible qu'un throw — pas une
  obligation transverse.
- Logger les erreurs avec le contexte : logger.error({ err, context })