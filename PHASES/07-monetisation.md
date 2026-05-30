# Phase 7 — Monétisation

<context>
Les Phases 1 à 6 sont terminées : le produit est fonctionnellement complet
(scraping, IA, signals, alertes, digest, discovery, enrichissement, fiche
concurrent, battle cards, notifications temps-réel, détection de nouveaux
concurrents).

Cette phase ajoute la monétisation : abonnements Stripe, limites par plan
(free tier), gating des features, et le dashboard de billing.

HORS PÉRIMÈTRE : la landing page et le polish du design global seront faits
séparément avec Claude Design. Cette phase ne touche PAS à la landing page.

Plans tarifaires :
- Free      0€     2 concurrents,  digest hebdo,  email
- Starter   29€/m  5 concurrents,  digest quotidien, Slack, source jobs
- Pro       79€/m  15 concurrents, alertes temps-réel, battle cards, reviews
- Business  199€/m illimité, multi-utilisateurs, API, exports

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/rules/api-routes.md
- @packages/db/CLAUDE.md
- @apps/api/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- Les limites par plan sont définies et appliquées (quotas + features)
- Un utilisateur ne peut pas dépasser le nombre de concurrents de son plan
- Les features premium sont gatées (battle cards, reviews, Slack, alertes RT, API)
- Stripe Checkout permet de souscrire à un plan
- Le Stripe Customer Portal permet de gérer l'abonnement
- Les webhooks Stripe mettent à jour le plan de l'org automatiquement
- Un dashboard de billing affiche le plan actuel + usage
- Des paywalls contextuels invitent à upgrade quand une limite est atteinte
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances

```bash
pnpm add stripe --filter @outrival/api
```

Ajouter dans `.env.local` :
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_YEARLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_YEARLY=price_...
```

(Les price IDs viennent de l'étape 3 — laisser vides pour l'instant.)

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install stripe`

---

## Étape 1 — Limites par plan (packages/shared)

### packages/shared/src/constants/plans.ts
```typescript
import type { SourceType, MonitorFrequency } from "./sources";

export type Plan = "free" | "starter" | "pro" | "business";

export interface PlanLimits {
  maxCompetitors: number; // Infinity pour business
  allowedFrequencies: MonitorFrequency[];
  allowedChannels: Array;
  allowedSources: SourceType[];
  features: {
    battleCards: boolean;
    realtimeAlerts: boolean;
    api: boolean;
    multiUser: boolean;
  };
}

export const PLAN_LIMITS: Record = {
  free: {
    maxCompetitors: 2,
    allowedFrequencies: ["weekly"],
    allowedChannels: ["email"],
    allowedSources: ["homepage", "pricing", "blog"],
    features: { battleCards: false, realtimeAlerts: false, api: false, multiUser: false },
  },
  starter: {
    maxCompetitors: 5,
    allowedFrequencies: ["daily", "weekly"],
    allowedChannels: ["email", "slack"],
    allowedSources: ["homepage", "pricing", "blog", "jobs"],
    features: { battleCards: false, realtimeAlerts: false, api: false, multiUser: false },
  },
  pro: {
    maxCompetitors: 15,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: ["homepage", "pricing", "blog", "jobs", "g2_reviews", "capterra_reviews"],
    features: { battleCards: true, realtimeAlerts: true, api: false, multiUser: false },
  },
  business: {
    maxCompetitors: Number.POSITIVE_INFINITY,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: ["homepage", "pricing", "blog", "jobs", "g2_reviews", "capterra_reviews", "appstore_reviews"],
    features: { battleCards: true, realtimeAlerts: true, api: true, multiUser: true },
  },
};

export const PLAN_PRICING = {
  starter: { monthly: 29, yearly: 290 },
  pro: { monthly: 79, yearly: 790 },
  business: { monthly: 199, yearly: 1990 },
} as const;
```

Réexporter depuis packages/shared/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/shared

Commit : `feat(shared): add plan limits and pricing config`

---

## Étape 2 — Enforcement des quotas + gating (apps/api)

### apps/api/src/lib/plan.ts
Helpers réutilisables :
```typescript
import { PLAN_LIMITS, type Plan } from "@outrival/shared";

export function getPlanLimits(plan: Plan) {
  return PLAN_LIMITS[plan];
}

export async function canAddCompetitor(orgId: string, plan: Plan): Promise {
  const count = await db.$count(competitors,
    and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
  return count < PLAN_LIMITS[plan].maxCompetitors;
}

export function isFeatureAllowed(plan: Plan, feature: keyof typeof PLAN_LIMITS["free"]["features"]): boolean {
  return PLAN_LIMITS[plan].features[feature];
}

export function isSourceAllowed(plan: Plan, source: SourceType): boolean {
  return PLAN_LIMITS[plan].allowedSources.includes(source);
}
```

### Appliquer le gating dans les routes existantes (surgical)

- POST /api/competitors et /api/onboarding/complete :
  → si !canAddCompetitor → 403 { error: "plan_limit_competitors", limit }
- POST /api/competitors/:id/monitors :
  → si !isSourceAllowed(plan, source) → 403 { error: "plan_locked_source" }
  → si frequency non autorisée → ajuster ou 403
- POST /api/competitors/:id/battle-card/generate :
  → si !isFeatureAllowed(plan, "battleCards") → 403 { error: "plan_locked_feature" }
- Routes reviews (g2/capterra monitors) :
  → gatées par isSourceAllowed
- SSE /api/notifications/stream (alertes temps-réel) :
  → reste accessible, mais les alertes RT sur signal sont gatées par
    isFeatureAllowed(plan, "realtimeAlerts") côté send-alert

Chaque refus retourne un code d'erreur structuré que le frontend pourra
transformer en paywall (voir étape 5).

→ vérifier : un compte free bloqué à 2 concurrents, battle card refusée

Commit : `feat(api): enforce plan quotas and feature gating`

---

## Étape 3 — Stripe (produits, checkout, portal, webhook)

### Setup Stripe Dashboard (manuel)
Créer dans Stripe (mode test) :
- 3 produits : Starter, Pro, Business
- 2 prix par produit : mensuel + annuel
- Copier les price IDs dans .env.local (étape 0)

### apps/api/src/lib/stripe.ts
```typescript
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-04-30.basil",
});
```

### apps/api/src/routes/billing.ts
```
GET /api/billing
  → { plan, usage: { competitors: { used, limit } }, features }

POST /api/billing/checkout
  body: { plan: "starter"|"pro"|"business", period: "monthly"|"yearly" }
  → créer/récupérer le Stripe customer (stocker stripeCustomerId sur org)
  → créer une Checkout Session (mode subscription, price selon plan+period)
  → success_url / cancel_url vers le dashboard
  → retourner { url }

POST /api/billing/portal
  → créer une Customer Portal Session pour l'org
  → retourner { url }
```

### apps/api/src/routes/stripe-webhook.ts
Route SANS authMiddleware (vérifiée par signature Stripe).
```
POST /api/stripe/webhook
  → vérifier la signature (STRIPE_WEBHOOK_SECRET)
  → gérer les events :
    - checkout.session.completed → set org.plan + stripeCustomerId
    - customer.subscription.updated → mettre à jour org.plan selon le price
    - customer.subscription.deleted → repasser org.plan = "free"
  → retourner 200
```

Important : le webhook a besoin du raw body pour vérifier la signature.
Configurer Hono pour préserver le raw body sur cette route.

Enregistrer les routers dans index.ts (webhook AVANT les middlewares auth/json
qui pourraient consommer le body).

→ vérifier : checkout test (carte 4242...) → org.plan passe à pro via webhook
→ vérifier : portal accessible

Commit : `feat(api): add stripe checkout, customer portal, and webhooks`

---

## Étape 4 — UI billing (apps/web)

### apps/web/src/app/(dashboard)/settings/billing/page.tsx
- Plan actuel + usage (X/Y concurrents, barre de progression)
- Tableau des plans (Free / Starter / Pro / Business) avec features
- Toggle mensuel/annuel (-17% annuel)
- Bouton "Passer à [plan]" → POST /billing/checkout → redirect vers Stripe
- Si déjà abonné : bouton "Gérer mon abonnement" → POST /billing/portal
- Au retour de Stripe (success_url) : toast de confirmation

Design Outrival (dark, amber, Syne + Inter, shadcn new-york).

→ vérifier : souscrire à un plan depuis l'UI → plan mis à jour au retour

Commit : `feat(web): add billing dashboard with plan management`

---

## Étape 5 — Paywalls contextuels (apps/web)

### apps/web/src/components/outrival/paywall-dialog.tsx
Composant réutilisable affiché quand l'API retourne un code plan_* :
- plan_limit_competitors → "Vous avez atteint la limite de votre plan.
  Passez à un plan supérieur pour suivre plus de concurrents."
- plan_locked_feature → "Cette fonctionnalité est disponible à partir du plan Pro."
- plan_locked_source → "Cette source nécessite un plan supérieur."
- Bouton "Voir les plans" → /settings/billing

### Brancher le paywall (surgical)
- Sur "Ajouter un concurrent" si 403 plan_limit_competitors → ouvrir le paywall
- Sur "Générer battle card" si 403 plan_locked_feature → ouvrir le paywall
- Sur l'ajout de sources gatées → ouvrir le paywall
- Le paywall doit être doux (contextuel, pas bloquant agressif)

→ vérifier : un compte free qui tente d'ajouter un 3e concurrent voit le paywall

Commit : `feat(web): add contextual upgrade paywalls`

---

## Étape 6 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm dev && pnpm trigger:dev
```

Test end-to-end (Stripe en mode test, carte 4242 4242 4242 4242) :
1. Compte free : ajouter 2 concurrents OK, le 3e → paywall
2. Tenter de générer une battle card en free → paywall
3. Aller dans billing → souscrire au plan Pro (checkout Stripe test)
4. Au retour : org.plan = pro (via webhook)
5. Vérifier : on peut maintenant ajouter jusqu'à 15 concurrents
6. Vérifier : battle cards + sources reviews débloquées
7. Ouvrir le Customer Portal → annuler l'abonnement
8. Vérifier : org repasse en free (via webhook subscription.deleted)

---

## Étape 7 — Mettre à jour le planning

task_plan.md :
- Phase 7 Monétisation → complete ✓
- Toutes les phases core terminées ✓
- Reste : landing page + design global via Claude Design (hors phases Claude Code)

findings.md :
- Configuration Stripe (price IDs, webhook events gérés)
- Particularité du raw body Hono pour le webhook
- Réglages de gating par plan

progress.md : log de session.
</task>

<constraints>
- Ne PAS créer ni toucher à la landing page (faite avec Claude Design séparément)
- Ne pas modifier le design system existant (polish global fait avec Claude Design)
- Le webhook Stripe ne doit PAS passer par authMiddleware (signature uniquement)
- Le webhook a besoin du raw body — configurer Hono en conséquence
- Les quotas et le gating utilisent PLAN_LIMITS de @outrival/shared (source unique de vérité)
- Surgical : appliquer le gating dans les routes existantes sans les réécrire
- Les paywalls sont doux et contextuels, jamais bloquants agressifs
- Stripe en mode test pour toute cette phase
- business a maxCompetitors = Infinity (gérer le cas dans l'UI : afficher "illimité")
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/rules/api-routes.md
@packages/db/CLAUDE.md
@apps/api/CLAUDE.md
@apps/web/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Un compte free est bloqué à 2 concurrents (3e → paywall)
✓ Les features premium sont gatées selon le plan (battle cards, reviews, RT)
✓ Stripe Checkout fonctionne (carte test) et crée l'abonnement
✓ Le webhook met à jour org.plan automatiquement
✓ Le Customer Portal permet de gérer/annuler l'abonnement
✓ L'annulation repasse l'org en free via webhook
✓ Le dashboard billing affiche plan + usage corrects
✓ Les paywalls contextuels s'affichent aux bons endroits
✓ La landing page n'a PAS été touchée
✓ task_plan.md Phase 7 = complete
</verification>

<commit>
Commits dans l'ordre :
chore(deps): install stripe
feat(shared): add plan limits and pricing config
feat(api): enforce plan quotas and feature gating
feat(api): add stripe checkout, customer portal, and webhooks
feat(web): add billing dashboard with plan management
feat(web): add contextual upgrade paywalls
feat(web): add billing dashboard with plan management
</commit>