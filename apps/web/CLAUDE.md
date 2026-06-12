# @outrival/web — Next.js App Router

Stack : Next.js 15, Tailwind v4, shadcn/ui new-york, Better Auth client

## Conventions
- App Router uniquement — pas de pages/ directory
- Server Components par défaut — Client Component uniquement si interactivité requise
- "use client" en haut du fichier, jamais dans un Server Component
- Fetching : fetch dans les Server Components, TanStack Query dans les Client Components
- Formulaires : react-hook-form + zod + shadcn/ui Form
- Auth : useSession() de Better Auth pour l'état client

## Structure src/
- app/          Routes (layout.tsx, page.tsx, loading.tsx, error.tsx)
- components/   Composants réutilisables (ui/ pour shadcn, outrival/ pour custom)
- lib/          Utilitaires client (api.ts, auth.ts, utils.ts)
- hooks/        Custom hooks React

## Design system Outrival
- Source de vérité : `PRODUCT.md` (stratégie/register) + `DESIGN.md` (système visuel) à la racine du repo
- Couleurs : OKLCH dark-first (hue 260 teinté), light + dark via next-themes (`:root` = light) ; accent unique cyan « signal » hue ~200 rationné au CTA + focus ring (`--link` pour liens/icônes). Tokens dans `globals.css`
- Typo : Bricolage Grotesque (display/titres, axes opsz+wdth) + Geist Sans (corps/UI) + Geist Mono (data/IDs, tabular-nums + slashed-zero) — `globals.css` + `layout.tsx`
- Échelle type = tokens uniquement, **jamais `text-[Npx]`** : `text-micro`(10) `text-meta`(11) `text-xs`(12) `text-dense`(13) `text-sm`(14) `text-content`(15) `text-base`(16) `text-lead`(17) `text-lg`(18) `text-xl`(20) · titres de page `text-title`(22)/`text-title-lg`(26) · KPI `text-stat`(32). Définis dans `globals.css @theme`, doc dans `DESIGN.md §3`. Un nouveau rôle = un nouveau token, pas une valeur arbitraire.
- **Plancher de taille** (DESIGN.md §3 « Small-Text Floor Rule ») : la prose lue (insight, description, helper, empty state) plancher à `text-sm`(14), lecture primaire `text-content`(15) ; labels/badges plancher à `text-meta`(11) — `text-micro`(10) reste défini (plancher a11y) mais **retiré de l'usage** (10px uppercase/mono = « fait IA »). Hiérarchie sous le body par graisse + couleur (muted), pas en rétrécissant. Seule exception 12–13px : les labels de champ de formulaire.
- Ne jamais utiliser de couleurs hardcodées — variables CSS Tailwind. Pas de `text-white`/`bg-white/N` (casse en light), pas d'alpha `/70`–`/80` sur `text-muted-foreground` (passe sous 4.5:1).
- Icônes : lucide-react uniquement