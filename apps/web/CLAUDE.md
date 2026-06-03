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
- Couleurs : light + dark à parité (next-themes, `:root` = light), accent unique amber #F59E0B
- Typo : Bricolage Grotesque (sans + display) + DM Mono (data/metadata) — défini dans `globals.css` + `layout.tsx`
- Ne jamais utiliser de couleurs hardcodées — variables CSS Tailwind
- Icônes : lucide-react uniquement