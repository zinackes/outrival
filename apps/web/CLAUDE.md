# @outrival/web — Next.js App Router

Stack : Next.js 15, Tailwind v4, shadcn/ui new-york, Better Auth client

## Conventions
- App Router uniquement — pas de pages/ directory
- Server Components par défaut — Client Component uniquement si interactivité requise
- "use client" en haut du fichier, jamais dans un Server Component
- Fetching : fetch dans les Server Components, TanStack Query dans les Client Components — pattern, prefetch SSR + hydration, conventions queryKey : `docs/tanstack-query.md`
- Formulaires : react-hook-form + zod + shadcn/ui Form
- Auth : useSession() de Better Auth pour l'état client

## Structure src/
- app/          Routes (layout.tsx, page.tsx, loading.tsx, error.tsx)
- components/   Composants réutilisables (ui/ pour shadcn, outrival/ pour custom)
- lib/          Utilitaires client (api.ts, auth.ts, utils.ts)
- hooks/        Custom hooks React

## Design system Outrival
- Source de vérité : `DESIGN.md` (système visuel) à la racine du repo
- Couleurs : OKLCH dark-first ; surfaces dark = **graphite neutre** (sans teinte, R≈G≈B — l'ancien navy `#101319` est retiré), light garde un soupçon de hue 260 ; light + dark via next-themes (`:root` = light) ; accent rationné CTA + focus ring (cyan en light, Iris indigo en dark ; `--link` pour liens/icônes). Tokens dans `globals.css`
- Typo : **Geist Sans pour display/titres ET corps/UI** (une seule grotesque neutre — la hiérarchie vient du poids/taille/tracking, pas d'une police de titre typée) + Geist Mono (data/IDs, tabular-nums + slashed-zero) ; landing = Zodiak serif (registre brand) — `globals.css` + `layout.tsx`
- Échelle type = tokens uniquement, **jamais `text-[Npx]`** : `text-micro`(10) `text-meta`(11) `text-xs`(12) `text-dense`(13) `text-sm`(14) `text-content`(15) `text-base`(16) `text-lead`(17) `text-lg`(18) `text-xl`(20) · titres de page `text-title`(26)/`text-title-lg`(34) · KPI `text-stat`(44). Définis dans `globals.css @theme`, doc dans `DESIGN.md §3`. Un nouveau rôle = un nouveau token, pas une valeur arbitraire.
- **Plancher de taille** (DESIGN.md §3 « Small-Text Floor Rule ») : la prose lue (insight, description, helper, empty state) plancher à `text-sm`(14), lecture primaire `text-content`(15) ; labels/badges plancher à `text-meta`(11) — `text-micro`(10) reste défini (plancher a11y) mais **retiré de l'usage** (10px uppercase/mono = « fait IA »). Hiérarchie sous le body par graisse + couleur (muted), pas en rétrécissant. Seule exception 12–13px : les labels de champ de formulaire.
- Ne jamais utiliser de couleurs hardcodées — variables CSS Tailwind. Pas de `text-white`/`bg-white/N` (casse en light), pas d'alpha `/70`–`/80` sur `text-muted-foreground` (passe sous 4.5:1).
- Icônes : `@/components/icons` uniquement — plus aucun package d'icônes. Le module inline le tier **gratuit d'Iconsax** en style `linear` (grille 24, `stroke-width` 2, `currentColor`), récupéré via leur MCP officiel ; le header du fichier documente la provenance, la licence et comment en ajouter une. Noms suffixés `Icon` (`CheckIcon`, `CaretRightIcon`) ; le type d'un composant icône s'importe en `import type { Icon as PhosphorIcon } from "@/components/icons"` (`Icon` seul entrerait en collision avec le `const Icon = …` des rendus dynamiques ; l'alias garde son nom historique pour ne pas toucher les tables de lookup). Le loader est `SpinnerIcon` et n'anime pas tout seul — c'est l'appelant qui pose `animate-spin`.
- **Grille de taille des icônes : 14 / 16 / 20 / 24.** `size-3.5` / `size-4` / `size-5` / `size-6` côté classes. Pas de prop `weight` (elle était propre à Phosphor) et jamais de `strokeWidth` au cas par cas : une seule graisse pour tout le produit.
- **14 = l'icône POSÉE DANS du texte de meta** (`text-meta` 11 · `text-xs` 12 · `text-dense` 13) : ligne de statut, lien externe collé à une URL, marqueur « detected auto », chevron d'un lien inline. 16 restait la seule taille autorisée, mais les glyphes Iconsax dessinent de 2 à 22 sur la grille 24, donc l'encre remplit ~83% de la boîte : à 16px, à côté d'un texte de 12, l'icône fait 1,7× la hauteur d'x et c'est ELLE qu'on lit en premier. Une icône dans un contrôle (Button, item de menu, badge, tuile) garde 16 : c'est la hauteur du contrôle qui donne le rythme, pas la hauteur d'x du texte.
- **Le trait est à 2, pas au 1.5 d'origine d'Iconsax.** Seules 36% des coordonnées du set tombent sur un entier de la grille 24, donc à 16px un trait ne s'aligne quasiment jamais sur un pixel : il se répartit sur deux rangées et se lit gris. Mesuré au rendu, 1.5 ne laissait que 3% des pixels allumés à pleine opacité, contre 24% à 2. Le reste est de l'anti-aliasing, et c'est ça qu'on voyait comme du flou et de la maigreur. Monter la taille ne corrige pas ça, seulement l'encre le fait.