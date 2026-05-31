# Phase 11 — API publique (feature `api`, plan business)

> **État actuel** : le flag `PLAN_LIMITS.business.features.api` vaut `true`, et
> `isFeatureAllowed(plan, "api")` existe (`apps/api/src/lib/plan.ts:49`), mais
> **aucun caller** — le flag n'est lu que par le tableau marketing
> `billing-dashboard.tsx:95` ("API access"). Il n'y a ni clés API, ni table, ni
> middleware d'auth par clé, ni routes publiques. Cette phase rend la feature réelle.
>
> **Objectif** : exposer une API publique versionnée (`/v1/*`), authentifiée par
> clé API, scoppée à l'org, gated au plan business, rate-limitée, documentée.

---

## Décision d'architecture

**Auth par clé = plugin `apiKey` de Better Auth** (pas de table maison).

Raison : le projet utilise déjà Better Auth + `drizzleAdapter`
(`apps/api/src/lib/auth.ts`). Le plugin fournit hashing, vérification,
expiration, et rate-limit par clé. Les clés sont liées à un `userId` → l'org se
résout via `ensureUserOrg(userId)`, exactement comme l'auth session actuelle.

> ⚠️ À l'exécution, vérifier l'API exacte du plugin `apiKey` pour Better Auth
> v1.6 via context7 (`resolve-library-id` → `query-docs better-auth api key plugin`) :
> noms d'endpoints (`createApiKey` / `verifyApiKey` / `listApiKeys` / `deleteApiKey`),
> shape du retour de `verifyApiKey`, options de rate-limit. Les noms ci-dessous
> sont la cible mais peuvent varier d'une mineure.

Alternative (table maison) documentée en **Annexe A** si le plugin ne convient pas.

---

## Critères de succès (vérifiables)

1. `pnpm typecheck` passe.
2. `pnpm db:push` applique la table `apikey` proprement (diff attendu = nouvelle table seulement).
3. Une org **business** peut générer une clé via l'UI settings ; une org non-business
   reçoit `plan_locked_feature` → `<PaywallDialog>`.
4. `curl -H "x-api-key: <key>" $API/v1/competitors` renvoie les competitors de l'org
   de la clé, et **uniquement** ceux-là.
5. Une clé invalide/absente → `401`. Une clé d'une org repassée free → `403 plan_locked_feature`.
6. Dépassement du quota de rate-limit → `429`.
7. Tests d'intégration verts (auth ok / auth ko / scoping org / gating plan / rate-limit).

---

## Plan d'exécution

### Étape 1 — Plugin Better Auth + table `apikey`
- `apps/api/src/lib/auth.ts` : `import { apiKey } from "better-auth/plugins"` puis
  `plugins: [apiKey({ rateLimit: { enabled: true, maxRequests: 100, timeWindow: 60_000 } })]`.
  (Ajuster les valeurs ; le rate-limit du plugin est par clé.)
- Générer le schéma drizzle de la table : `npx @better-auth/cli generate` (sortie =
  table `apikey`) → recopier la définition dans `packages/db/src/schema/auth.ts`
  (le barrel `packages/db/src/schema/index.ts` ré-exporte déjà `./auth`, rien à ajouter).
- **Vérifier** : `pnpm db:push` → table `apikey` créée, pas d'autre diff.

### Étape 2 — Middleware d'auth par clé (`apps/api/src/middleware/api-key.ts`)
Nouveau middleware Hono (factory, comme `middleware/auth.ts`) :
1. Lire l'en-tête `x-api-key` (sinon `Authorization: Bearer <key>`). Absent → `401`.
2. `auth.api.verifyApiKey({ body: { key } })` → si invalide → `401`.
3. Résoudre `userId` depuis la clé → `orgId = await ensureUserOrg(userId)` (`lib/org.ts`).
4. `plan = await getOrgPlan(orgId)` ; si `!isFeatureAllowed(plan, "api")` →
   `c.json({ error: "plan_locked_feature", feature: "api", plan }, 403)`
   (réutilise le code d'erreur existant, déjà parsé par `paywallFromError`).
5. `c.set("apiOrgId", orgId)` + `c.set("apiPlan", plan)`. `await next()`.
- Le rate-limit `429` est porté par le plugin ; sinon ajouter un compteur ici.

### Étape 3 — Routes publiques versionnées (`apps/api/src/routes/v1/`)
- Routeur Hono monté **après** le webhook Stripe, sous `/v1`, protégé par
  `apiKeyMiddleware` (pas `authMiddleware`).
- Exposer en **lecture seule** d'abord (scope `orgId` partout, JAMAIS de leak cross-org) :
  - `GET /v1/competitors` (+ `/:id`)
  - `GET /v1/signals` (filtres `?severity`, `?category`, `?since`)
  - `GET /v1/changes`
  - `GET /v1/digests`
- Réutiliser les requêtes Drizzle existantes des routes internes en filtrant sur
  `c.get("apiOrgId")`. Pagination cursor/limit, réponses `{ data, error }` (cf. `apps/api/CLAUDE.md`).
- `apps/api/src/index.ts` : `import { v1Router } ...` + `app.route("/v1", v1Router)`.
- **Vérifier** : critère de succès 4 + 5 au `curl`.

### Étape 4 — Gating réel du flag (fermer la dette actuelle)
- Le gating vit dans le middleware (étape 2.4). Pas d'autre endroit à toucher :
  `isFeatureAllowed` a désormais un caller → la dette "flag jamais lu" est résolue.

### Étape 5 — UI gestion des clés (web, business only)
- Endpoints internes (auth **session**, pas clé) sur le routeur settings ou un
  nouveau `apps/api/src/routes/api-keys.ts` monté sous `/api/api-keys`, protégé par
  `authMiddleware` + check `isFeatureAllowed(plan, "api")` → `plan_locked_feature` :
  - `POST /api/api-keys` (create → renvoie la clé en clair **une seule fois**)
  - `GET /api/api-keys` (liste : id, nom, préfixe masqué, lastUsed, createdAt)
  - `DELETE /api/api-keys/:id` (revoke)
  - Mapper vers `auth.api.createApiKey/listApiKeys/deleteApiKey`.
- Web :
  - Ajouter une entrée "API" dans `apps/web/src/components/dashboard/settings-nav.tsx`.
  - Page `apps/web/src/app/dashboard/settings/api/page.tsx` : liste + bouton "Generate key"
    (affiche la clé en clair une fois, copy-to-clipboard) + revoke.
  - Helpers dans `apps/web/src/lib/api.ts` (`createApiKey`, `listApiKeys`, `deleteApiKey`).
  - Non-business → `paywallFromError(err)` + `<PaywallDialog>` (pattern existant,
    `apps/web/src/components/outrival/paywall-dialog.tsx:77`).

### Étape 6 — Docs API publique
- `docs/api/openapi.yaml` (ou route `GET /v1/openapi.json`) décrivant les endpoints v1.
- Page de référence `apps/web/src/app/(marketing)/docs/api/page.tsx` (ou MDX) :
  auth par header, exemples `curl`, rate-limits, codes d'erreur (`401`, `403`, `429`).
- Mettre à jour `docs/architecture.md` :
  - Ajouter `apikey` à la liste des tables Better Auth.
  - Déplacer "Phase 11 : API publique" de la roadmap vers une section "API publique"
    (auth par clé, scope org, gating business, versioning `/v1`).

### Étape 7 — Tests
- Intégration (`apps/api`) :
  - clé valide business → `200` + données scoppées à l'org de la clé,
  - aucune clé → `401`, clé invalide → `401`,
  - org non-business → `403 plan_locked_feature`,
  - rate-limit dépassé → `429`,
  - pas de leak cross-org (clé org A ne voit pas les competitors org B).
- **Vérifier** : `pnpm test` vert + `pnpm typecheck`.

---

## Fichiers touchés (récap)

**Créés**
- `apps/api/src/middleware/api-key.ts`
- `apps/api/src/routes/v1/index.ts` (+ sous-routes competitors/signals/changes/digests)
- `apps/api/src/routes/api-keys.ts`
- `apps/web/src/app/dashboard/settings/api/page.tsx`
- `docs/api/openapi.yaml`

**Modifiés**
- `apps/api/src/lib/auth.ts` (plugin `apiKey`)
- `packages/db/src/schema/auth.ts` (table `apikey`)
- `apps/api/src/index.ts` (montage `/v1` + `/api/api-keys`)
- `apps/web/src/lib/api.ts` (helpers clés)
- `apps/web/src/components/dashboard/settings-nav.tsx` (entrée "API")
- `docs/architecture.md` (table `apikey` + section API publique, retrait de la roadmap)

**Inchangé mais déterminant**
- `packages/shared/src/constants/plans.ts` — `features.api` est déjà `true` pour business.
- `apps/api/src/lib/plan.ts` — `isFeatureAllowed` réutilisé tel quel (gagne enfin un caller).

---

## Points d'attention

- **Scope org systématique** : chaque query v1 filtre sur `c.get("apiOrgId")`.
  Le risque #1 d'une API publique est le leak cross-tenant — à tester explicitement.
- **Clé affichée une seule fois** : on stocke le hash (géré par le plugin), jamais le clair.
- **Lecture seule au départ** : pas de mutations v1 dans cette phase (POST/DELETE plus tard).
- **CORS** : `/v1` est consommé serveur-à-serveur (header clé), donc **pas** de
  `credentials: true` ni d'origin restreint comme pour `/api`. Vérifier que la config
  CORS de `index.ts` ne bloque pas les appels cross-origin sans cookie sur `/v1`.
- **`multiUser`** (aussi `true` pour business, aussi jamais checké) reste hors scope —
  clés liées au user, org dérivée. À revoir si Phase 10 (multi-user/RBAC) arrive avant.
- **Rate-limit** : `apps/api/CLAUDE.md` mentionne un `middleware/ratelimit.ts` qui
  n'existe pas. Le plugin Better Auth couvre le besoin par clé ; ne pas créer de
  middleware générique non demandé (Karpathy — simplicity first).

---

## Annexe A — Alternative table maison (si plugin écarté)

Table `packages/db/src/schema/api_keys.ts` :
```
api_keys   id, org_id (fk → organizations, cascade), name, key_hash (sha-256),
           key_prefix (8 chars affichés), last_used_at, expires_at,
           created_at, revoked_at
```
- Génération : `ork_<32 bytes base62>`, on stocke `sha256(key)` + préfixe en clair.
- Middleware : hash l'en-tête entrant, lookup par hash, vérifie `revoked_at`/`expires_at`,
  bump `last_used_at` (best-effort).
- Rate-limit : nécessite un store (compteur Postgres ou réintroduction d'Upstash —
  cf. note Phase 6 dans `architecture.md`). C'est le surcoût principal vs le plugin.
- Ajouter `export * from "./api_keys"` au barrel `packages/db/src/schema/index.ts`.
