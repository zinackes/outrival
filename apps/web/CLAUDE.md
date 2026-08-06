# @outrival/web

Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui new-york, Better Auth client.

## Conventions

- App Router. Server Component par défaut, `"use client"` si interactivité réelle.
- Fetching : `fetch` dans les Server Components, TanStack Query dans les Client
  Components (prefetch SSR + hydratation, queryKey : `docs/tanstack-query.md`).
- Formulaires : react-hook-form + zod + shadcn/ui `Form`.
- Tout l'user-facing est en **anglais** (`.claude/rules/language.md`).

## Design system

`DESIGN.md` est la source, ne pas la recopier ici. Les 4 invariants les plus régressés :

- **Échelle = tokens uniquement**, jamais `text-[Npx]` : `text-meta`(11) jusqu'à
  `text-stat`(44), dans `globals.css @theme`. Nouveau rôle = nouveau token. Plancher :
  prose lue à `text-sm`(14), labels à `text-meta`(11).
- **Les chiffres sont en sans**, pas en mono : `tabular-nums` sur Geist Sans. Mono
  seulement pour ce qui se lit glyphe par glyphe (`<kbd>`, ID, URL, code, diff).
- **Icônes : `@/components/icons` uniquement**, aucun package d'icônes, Iconsax est
  inliné. Grille 14/16/20/24, `stroke-width` 2 partout, pas de prop `weight`.
- **Aucune couleur hardcodée** : variables CSS. Pas de `text-white` ni `bg-white/N`
  (casse en light), pas d'alpha `/70` ni `/80` sur `text-muted-foreground` (< 4.5:1).

## tsconfig

`module: esnext` + `moduleResolution: bundler` override le NodeNext de la racine :
l'app est résolue par SWC, pas par Node. Sans ça, un `import()` sans extension
(`next/dynamic`) ne typecheck pas. Effet type-only, aucun effet runtime.

## Tests & build

`pnpm test:local --filter @outrival/web`. Les tests vivent dans `test/` et importent
`../src/lib/*` : **fonctions pures** (dérivation, formatage, parsing) uniquement,
pas de rendu de composant ni de runtime Next.

`build` est un vrai `next build`, pas un `tsc --noEmit` comme partout ailleurs, et
fait OOM la VM WSL2. Vérifier avec `pnpm typecheck --filter @outrival/web`.
