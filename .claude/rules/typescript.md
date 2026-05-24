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

- Pattern Result<T, E> pour les fonctions qui peuvent échouer
- Pas de throw dans les fonctions métier — retourner { ok: false, error }
- throw uniquement dans les cas vraiment exceptionnels (config manquante au startup)
- Logger les erreurs avec le contexte : logger.error({ err, context })