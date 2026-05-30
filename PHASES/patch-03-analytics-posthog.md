# Patch 03 — Analytics & comportement (PostHog Cloud EU)

<context>
Deuxième couche d'observabilité, avant la beta. Objectif : comprendre comment
les utilisateurs se comportent (pages, clics, parcours) pour améliorer l'UX,
et mesurer les funnels clés.

Outil unique : PostHog Cloud EU (hébergement UE = RGPD-clean). PostHog couvre
à lui seul : autocapture (pageviews + clics), session replay, funnels, heatmaps,
feature flags. Pas de Google Analytics (incompatible RGPD pour un produit UE).

CONTRAINTE RGPD CENTRALE : modèle OPT-IN. PostHog ne capture RIEN tant que
l'utilisateur n'a pas accepté via la bannière de consentement. Le session replay
masque les données sensibles (PII).

Ce patch inclut la bannière de consentement minimale (le mécanisme de gating).
La page politique de confidentialité / cookies complète viendra avec l'étape
légale — ici on pose le gating fonctionnel.

Lire avant : @CLAUDE.md, @docs/architecture.md, @apps/web/CLAUDE.md,
@docs/design-system.md, @apps/api/CLAUDE.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env + projet PostHog

```bash
# Client (Next.js)
pnpm add posthog-js --filter @outrival/web

# Serveur (events server-side critiques)
pnpm add posthog-node --filter @outrival/api
```

Créer un projet sur **PostHog Cloud EU** (eu.posthog.com). Récupérer la project
API key. Activer le session replay + les feature flags dans le projet.

Ajouter dans `.env.local` :
```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
POSTHOG_API_KEY=phc_...            # même clé projet, usage serveur
POSTHOG_HOST=https://eu.i.posthog.com
```

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install posthog client and node`

---

## Étape 1 — Consentement (le gating RGPD)

### apps/web/src/lib/consent.ts
Gestion du choix de consentement, persisté en cookie.
```typescript
const CONSENT_COOKIE = "ph_consent";

export type ConsentState = "granted" | "denied" | "unset";

export function getConsent(): ConsentState {
  if (typeof document === "undefined") return "unset";
  const match = document.cookie.match(/(?:^|;\s*)ph_consent=(granted|denied)/);
  return (match?.[1] as ConsentState) ?? "unset";
}

export function setConsent(state: "granted" | "denied"): void {
  // 6 mois
  document.cookie = `${CONSENT_COOKIE}=${state}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
}
```

### apps/web/src/components/outrival/consent-banner.tsx
Bannière affichée si consentement = "unset".
- Texte sobre : "Nous utilisons des analytics pour améliorer Outrival.
  Vous pouvez accepter ou refuser."
- Deux boutons : "Accepter" / "Refuser"
- Lien vers la politique de confidentialité (placeholder /privacy pour l'instant)
- "Accepter" → setConsent("granted") + posthog.opt_in_capturing()
- "Refuser" → setConsent("denied") (PostHog reste opt-out)
- Design Outrival (dark, amber, discret en bas de page, pas intrusif)

→ vérifier : la bannière apparaît au premier visit, disparaît après choix,
   le choix persiste au reload

Commit : `feat(web): add GDPR consent banner with cookie persistence`

---

## Étape 2 — Provider PostHog (Next.js App Router)

### apps/web/src/lib/posthog/provider.tsx ("use client")
```typescript
"use client";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { getConsent } from "../consent";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: "https://eu.posthog.com",
      person_profiles: "identified_only",   // profils uniquement pour users identifiés
      capture_pageview: false,              // on gère manuellement (App Router)
      autocapture: true,                    // clics + interactions auto
      opt_out_capturing_by_default: true,   // RGPD : rien tant que pas de consentement
      session_recording: {
        maskAllInputs: true,                // masque tous les champs de saisie
        maskTextSelector: "[data-ph-mask]", // masque les éléments marqués sensibles
      },
    });

    // Si consentement déjà donné, on opt-in immédiatement
    if (getConsent() === "granted") {
      posthog.opt_in_capturing();
    }
  }, []);

  return {children};
}
```

### apps/web/src/lib/posthog/pageview.tsx ("use client")
Capture manuelle des pageviews sur navigation (nécessaire en App Router).
```typescript
"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog.has_opted_in_capturing()) {
      let url = window.origin + pathname;
      if (searchParams?.toString()) url += `?${searchParams.toString()}`;
      posthog.capture("$pageview", { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}
```

### apps/web/src/app/layout.tsx
- Wrapper l'app dans <PostHogProvider>
- Inclure <PostHogPageView> (dans un <Suspense> — requis par useSearchParams)
- Inclure <ConsentBanner>

### Masquage PII
Marquer les zones sensibles avec data-ph-mask :
- Pages settings/billing (emails, infos de paiement)
- Tout affichage d'email utilisateur
maskAllInputs couvre déjà les champs de saisie.

→ vérifier (après avoir accepté le consentement) :
   pageviews + clics remontent dans PostHog ; session replay enregistre
   avec les inputs masqués

Commit : `feat(web): add posthog provider with EU config, autocapture, masked replay`

---

## Étape 3 — Identification des utilisateurs

À la connexion réussie (après login/signup), identifier l'utilisateur :
```typescript
import posthog from "posthog-js";

// après login/signup réussi
if (posthog.has_opted_in_capturing()) {
  posthog.identify(user.id, { plan: user.org.plan }); // PAS l'email en propriété
}

// au logout
posthog.reset();
```

Ne pas mettre l'email comme propriété de personne (PII). Utiliser userId.

→ vérifier : un user connecté apparaît identifié dans PostHog (par id)
→ vérifier : logout → reset (plus d'association)

Commit : `feat(web): identify users in posthog on auth`

---

## Étape 4 — Événements de funnel (client)

### apps/web/src/lib/posthog/events.ts
Helper typé pour les events :
```typescript
import posthog from "posthog-js";

export function track(event: string, props?: Record) {
  if (posthog.has_opted_in_capturing()) {
    posthog.capture(event, props);
  }
}
```

Instrumenter les points clés du funnel :
```
user_signed_up                  (après signup)
onboarding_started              (entrée onboarding)
onboarding_product_analyzed     (étape 2 onboarding ok)
onboarding_competitors_found    (discovery réussie)
onboarding_completed            (fin onboarding)
competitor_added                (ajout manuel d'un concurrent)
scrape_triggered                ("scraper maintenant")
battle_card_generated           (génération battle card)
paywall_shown                   (paywall affiché) + { reason }
paywall_cta_clicked             (clic "voir les plans")
```

Surgical : ajouter les appels track() aux bons endroits, sans réécrire les composants.

→ vérifier : compléter un onboarding → la séquence d'events apparaît dans PostHog

Commit : `feat(web): track key funnel events`

---

## Étape 5 — Événements server-side (apps/api)

Certains events critiques se passent côté serveur, pas client.

### apps/api/src/lib/posthog.ts
```typescript
import { PostHog } from "posthog-node";

export const posthogServer = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST,
});
```

Capturer les events serveur clés (distinctId = userId) :
```
signal_generated     (dans generate-signal — mais c'est dans workers, voir note)
plan_upgraded        (dans le webhook Stripe, à la souscription) + { plan, period }
plan_cancelled       (webhook Stripe subscription.deleted)
```

Note : `signal_generated` se produit dans les workers. Soit on ajoute posthog-node
aux workers aussi, soit on le track côté API quand le frontend lit les signals.
Décider : le plus fiable est de l'émettre dans le worker generate-signal. Si oui,
ajouter posthog-node à @outrival/workers et flush après capture.

Important : appeler posthogServer.shutdown() / flush proprement pour ne pas
perdre d'events (surtout côté workers, processus court).

→ vérifier : une souscription Stripe test → event plan_upgraded dans PostHog

Commit : `feat(api): track server-side conversion events`

---

## Étape 6 — Feature flags

Mettre en place le mécanisme (utile pour kill switches + rollout progressif).

### Exemple d'usage client
```typescript
import { useFeatureFlagEnabled } from "posthog-js/react";

const newOnboarding = useFeatureFlagEnabled("new-onboarding-flow");
```

Créer un premier flag de démonstration dans PostHog (ex: "kill-switch-discovery")
qui, si activé, désactive la discovery côté UI — utile en cas de problème Exa.ai
en prod sans redéployer.

→ vérifier : toggler le flag dans PostHog change le comportement côté app

Commit : `feat(web): add feature flag mechanism with example kill switch`

---

## Étape 7 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test :
1. Premier visit → bannière de consentement visible, AUCUN event PostHog avant choix
2. Refuser → toujours aucun tracking
3. Accepter → pageviews + clics remontent, session replay démarre
4. Reload → choix persisté, pas de re-prompt
5. Onboarding complet → séquence d'events de funnel dans PostHog
6. Session replay → vérifier que les champs et zones data-ph-mask sont masqués
7. Souscription Stripe test → event plan_upgraded server-side
8. Toggler un feature flag → effet visible

Mettre à jour findings.md :
- Projet PostHog EU configuré
- Liste des events trackés (client + serveur)
- Zones masquées (PII) dans le replay
- Note sur le flush server-side (workers)

task_plan.md : patch-03 → complete. Prochain : patch-05 (widget feedback).
</task>

<constraints>
- PostHog Cloud EU uniquement (api_host eu.i.posthog.com) — RGPD
- OPT-IN strict : opt_out_capturing_by_default true, rien avant consentement
- person_profiles "identified_only" (pas de profil pour les visiteurs anonymes)
- Session replay : maskAllInputs true + data-ph-mask sur les zones sensibles
- JAMAIS l'email comme propriété de personne PostHog — userId uniquement
- capture_pageview false côté init + capture manuelle (App Router)
- track() et capture ne s'exécutent QUE si has_opted_in_capturing()
- Server-side : flush/shutdown propre pour ne pas perdre d'events
- Surgical : instrumenter les events sans réécrire les composants
- La bannière est sobre et non-intrusive (design-system.md)
- Un commit par étape
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@docs/design-system.md
@apps/web/CLAUDE.md
@apps/api/CLAUDE.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Aucun tracking avant consentement (vérifiable dans l'onglet réseau)
✓ "Refuser" → aucun event ; "Accepter" → tracking actif
✓ Choix de consentement persisté (cookie 6 mois)
✓ Pageviews capturés sur navigation App Router
✓ Users identifiés par userId (jamais par email)
✓ Session replay actif avec inputs + zones sensibles masqués
✓ Séquence d'events de funnel visible dans PostHog
✓ Event plan_upgraded server-side sur souscription Stripe
✓ Feature flag fonctionnel (kill switch)
✓ task_plan.md patch-03 = complete
</verification>

<commit>
chore(deps): install posthog client and node
feat(web): add GDPR consent banner with cookie persistence
feat(web): add posthog provider with EU config, autocapture, masked replay
feat(web): identify users in posthog on auth
feat(web): track key funnel events
feat(api): track server-side conversion events
feat(web): add feature flag mechanism with example kill switch
</commit>