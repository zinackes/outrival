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
- Couleurs : dark theme, primary amber #F59E0B
- Typo : Syne (headings, logo) + Inter (body)
- Ne jamais utiliser de couleurs hardcodées — variables CSS Tailwind
- Icônes : lucide-react uniquement