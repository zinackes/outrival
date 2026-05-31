# Phase 10 — Multi-user orgs (RBAC + invitations, feature `multiUser`, plan business)

> **État actuel** : le flag `PLAN_LIMITS.business.features.multiUser` vaut `true`, et
> `isFeatureAllowed(plan, "multiUser")` existe (`apps/api/src/lib/plan.ts:49`), mais
> **aucun caller** — le flag n'est lu que par le tableau marketing
> (`billing-dashboard.tsx:96`, `paywall-dialog.tsx:52`). Le schéma est déjà prêt à
> 90 % : `users.orgId` + `roleEnum("role", ["owner","admin","member"])`
> (`packages/db/src/schema/users.ts`) existent, mais le `role` n'est **jamais lu**
> pour de l'autorisation, et il n'y a ni table d'invitations, ni routes `/team`, ni
> moyen d'ajouter un second user à une org. Aujourd'hui : **1 org = 1 user** (créé
> lazy par `ensureUserOrg`, toujours `owner`).
>
> **Objectif** : permettre à une org **business** d'inviter des coéquipiers par email,
> avec rôles (`owner`/`admin`/`member`) lus pour l'autorisation. Gated business,
> aligné sur l'archi existante, sans toucher au routage d'org des routes actuelles.

---

## Décision d'architecture

**Maison, aligné sur l'existant — PAS le plugin `organization` de Better Auth.**

Raison : le projet a déjà une table `organizations` riche (plan, stripe,
`productProfile`, `detectionConfig`…) et un lien `users.orgId` + `roleEnum`. Le
plugin Better Auth `organization` crée **ses propres** tables
`organization`/`member`/`invitation` → soit migrer toute la donnée métier vers
elles (lourd, touche billing/onboarding/scraping), soit faire cohabiter deux
notions d'org (pire que le dual-table `user`/`users` déjà présent). On étend donc
l'existant : **une table `org_invitations`**, le `role` existant devient
load-bearing, des routes `/api/team`.

**Modèle d'appartenance : 1 user = 1 org** (on garde `users.orgId`, une colonne).
- Un invité qui accepte voit son `users.orgId` ré-assigné vers l'org de l'inviteur.
- Pas de table de jointure `members`, pas d'« active org » en session, pas de
  switcher d'org. Toutes les routes qui font `ensureUserOrg(user.id)` continuent
  de marcher **inchangées** — c'est l'intérêt majeur de ce choix.
- « Plusieurs users dans une org » fonctionne déjà au niveau schéma (N lignes
  `users` avec le même `orgId`). C'est exactement le périmètre business voulu.

**Seats** : le gate est **binaire** (`multiUser` n'est `true` que pour business).
Non-business ne peut pas inviter du tout → de facto 1 seat. Business = seats
illimités au MVP. On **n'ajoute pas** `maxSeats` à `PLAN_LIMITS` (Karpathy —
pas de configurabilité non demandée) ; à introduire seulement si facturation
au siège un jour (voir Points d'attention).

---

## Critères de succès (vérifiables)

1. `pnpm typecheck` passe.
2. `pnpm db:push` applique la table `org_invitations` (+ enum `invitation_status`)
   proprement — diff attendu = **nouvelle table + nouvel enum uniquement**
   (`users`/`organizations` inchangés).
3. Une org **business** (`owner`/`admin`) peut inviter par email ; une org
   non-business reçoit `plan_locked_feature` (feature `multiUser`) →
   `<PaywallDialog>`.
4. L'invité reçoit un email Resend avec un lien ; après login/register il accepte,
   et son `users.orgId` pointe désormais sur l'org de l'inviteur (il voit ses
   competitors/signals).
5. Un `member` ne peut PAS inviter / révoquer / retirer un membre / changer un rôle
   (`403 forbidden_role`) ; `admin` et `owner` le peuvent.
6. Révoquer une invitation `pending` → le token n'est plus acceptable (`410`/`404`).
7. Retirer un membre → il perd l'accès (son `orgId` est remis à `null`, il
   récupère un workspace perso vierge au prochain `ensureUserOrg`).
8. **Aucun leak cross-org** : accepter une invitation ne donne accès qu'à l'org
   invitante ; l'`owner` ne peut pas être retiré ni rétrogradé.
9. Tests d'intégration verts (gating plan / matrice de rôles / accept / révocation /
   ré-assignation d'org / isolation).

---

## Plan d'exécution

### Étape 1 — Schéma : table `org_invitations`
- Nouveau `packages/db/src/schema/invitations.ts` :
  ```
  invitation_status  pgEnum: pending | accepted | revoked | expired

  org_invitations  id        text pk ($defaultFn randomUUID)
                   org_id    text fk → organizations.id (onDelete: cascade)
                   email     text notNull            (lowercased)
                   role      roleEnum notNull         (member | admin — jamais owner)
                   token     text notNull unique      (randomBytes base62)
                   status    invitation_status notNull default 'pending'
                   invited_by text                    (user id, audit)
                   expires_at timestamp notNull        (now + 7j)
                   created_at timestamp notNull defaultNow
                   accepted_at timestamp
  ```
  - Réutiliser `roleEnum` importé depuis `./users` (déjà exporté), restreint à
    `member|admin` via Zod côté route (pas un nouvel enum).
  - Index unique partiel souhaité sur `(org_id, lower(email)) WHERE status='pending'`
    pour éviter les doublons d'invitation ; si drizzle-kit ne le génère pas
    proprement, dédupe applicative (check avant insert) suffit au MVP.
- Ajouter `export * from "./invitations"` au barrel
  `packages/db/src/schema/index.ts`.
- **Vérifier** : critère 2 (`pnpm db:push`, diff = 1 table + 1 enum).

### Étape 2 — Helpers d'autorisation (`apps/api/src/lib/org.ts`)
Le `authMiddleware` pose déjà `c.set("user", session.user)` (`middleware/auth.ts`).
On a besoin du rôle + de l'org en une fois :
- `getUserMembership(userId): Promise<{ orgId: string; role: "owner"|"admin"|"member" }>`
  → lit `users` (orgId + role). Si `orgId` null, appelle `ensureUserOrg` (l'user
  redevient `owner` d'un workspace perso). Réutilise le pattern existant du fichier.
- **Middleware** `requireRole(...allowed: Role[])` dans
  `apps/api/src/middleware/require-role.ts` (factory comme `authMiddleware`) :
  monté **après** `authMiddleware`, lit `getUserMembership`, pose
  `c.set("orgId", …)` + `c.set("role", …)`, et `403 { error: "forbidden_role" }`
  si le rôle n'est pas autorisé.

### Étape 3 — Routes `/api/team` (`apps/api/src/routes/team.ts`)
Routeur Hono, `authMiddleware` sur `*`. Validation Zod sur tous les inputs.
Matrice d'autorisation :

| Action | Route | Qui |
|---|---|---|
| Lister membres + invitations pending | `GET /api/team` | tout membre |
| Inviter | `POST /api/team/invite` | owner, admin |
| Révoquer une invitation pending | `DELETE /api/team/invitations/:id` | owner, admin |
| Retirer un membre | `DELETE /api/team/members/:userId` | owner, admin |
| Changer le rôle d'un membre | `PATCH /api/team/members/:userId` | owner |
| Accepter une invitation | `POST /api/team/accept` | tout user authentifié |

- `GET /api/team` : `users` où `orgId = c.get("orgId")` (id, email, name, role) +
  `org_invitations` `status='pending'` non expirées. Marque l'`owner` et "you".
- `POST /api/team/invite` `{ email, role: "member"|"admin" }` :
  1. `requireRole("owner","admin")`.
  2. **Gate** : `plan = getOrgPlan(orgId)` ; `!isFeatureAllowed(plan, "multiUser")`
     → `c.json({ error: "plan_locked_feature", feature: "multiUser", plan }, 403)`
     (réutilise le code parsé par `paywallFromError`). **← le caller manquant.**
  3. Si un `users.email` est déjà dans l'org → `409 already_member`.
  4. Upsert invitation `pending` (token random, `expiresAt` +7j, `invitedBy`).
  5. Envoyer l'email (Étape 5). Réponse `{ data: { invitationId } }`.
- `POST /api/team/accept` `{ token }` :
  1. Lookup token → invitation `pending` non expirée (sinon `410 invitation_expired`
     / `404`).
  2. L'email de l'invitation doit matcher `c.get("user").email` (sinon
     `403 invitation_email_mismatch`).
  3. **Ré-assignation d'org** (voir Étape 4) : capture l'ancien `orgId` du user,
     set `users.orgId = invitation.orgId`, `users.role = invitation.role`.
  4. `invitation.status='accepted'`, `acceptedAt=now`.
  5. Cleanup de l'ancien workspace perso (Étape 4).
- `DELETE /api/team/members/:userId` : `requireRole("owner","admin")`.
  - Interdit de retirer le **dernier owner** / un `owner` (`403 cannot_remove_owner`).
  - Set `users.orgId = null` (l'user récupère un workspace perso vierge via
    `ensureUserOrg` au prochain hit). **Ne pas** supprimer ses competitors de l'org
    invitante — ils appartiennent à l'org, pas au user.
- `PATCH /api/team/members/:userId` `{ role }` : `requireRole("owner")`.
  - Ne peut pas se rétrograder soi-même si dernier owner ; `member ↔ admin`
    seulement (transfert d'ownership = hors scope, voir Points d'attention).
- `apps/api/src/index.ts` : `import { teamRouter }` + `app.route("/api/team", teamRouter)`.
- **Vérifier** : critères 3, 5, 6, 7, 8 au `curl`.

### Étape 4 — Ré-assignation & cleanup du workspace perso (le point délicat)
Un invité déjà inscrit a une ligne `users` et, s'il a déjà touché le dashboard, un
`orgId` perso (workspace free créé par `ensureUserOrg`, possiblement avec des
competitors/monitors). À l'accept :
- Capturer `previousOrgId`.
- Ré-assigner (`users.orgId = invitation.orgId`).
- Si `previousOrgId` existait et n'a **plus aucun membre** (`count(users where
  orgId=previousOrgId) === 0`) **ET** `stripeSubscriptionId` est `null` →
  `DELETE` l'org (cascade supprime competitors/monitors/snapshots… via les FK
  `onDelete: cascade`). Ça évite des orgs orphelines scrappées pour rien.
- Si l'ancien org a un `stripeSubscriptionId` actif → **ne pas** supprimer ;
  renvoyer `409 abandon_paid_org` avec un message clair ("annule d'abord ton
  abonnement avant de rejoindre une autre équipe"). Cas rare mais à garder propre.
- **Vérifier** : critère 4 + test "invité avec ancien workspace → ancien org
  supprimé, nouvel accès OK".

### Étape 5 — Email d'invitation (Resend)
- L'API n'a pas encore de client Resend dans `lib/` — `routes/notifications.ts`
  appelle déjà `https://api.resend.com/emails` par `fetch` direct. Suivre le même
  pattern, ou extraire un mini `apps/api/src/lib/resend.ts` sur le modèle de
  `apps/workers/src/lib/resend.ts` (`getResend()` + `from` env). **Pas** d'import
  cross-app workers→api interdit ; rester local à l'API.
- Contenu : lien `${WEB_URL}/invite?token=<token>`, nom de l'org, rôle, expiration.
- Best-effort : si l'email échoue, l'invitation reste `pending` (le lien marche
  quand même) — logger, ne pas throw la route.

### Étape 6 — UI web (settings "Team", business)
- Entrée "Team" dans `apps/web/src/components/dashboard/settings-nav.tsx`.
- Page `apps/web/src/app/dashboard/settings/team/page.tsx` :
  - Liste membres (email, rôle, badge "you"/"owner"), invitations pending.
  - Bouton "Invite member" (email + select rôle `member|admin`).
  - Actions par ligne selon le rôle courant : révoquer invitation, retirer membre,
    changer rôle (owner only). Masquer/disable selon `role` (l'API reste la source
    de vérité — défense en profondeur).
  - Non-business → `paywallFromError(err)` + `<PaywallDialog>` (label `multiUser` =
    "Multi-user" déjà mappé `paywall-dialog.tsx:52`).
- Page d'acceptation `apps/web/src/app/(auth)/invite/page.tsx` :
  - Lit `?token`. Si non authentifié → redirige vers register/login en
    **préservant le token** (querystring), puis `POST /api/team/accept` une fois
    connecté. Si déjà connecté → accept direct + redirect dashboard.
- Helpers `apps/web/src/lib/api.ts` : `listTeam`, `inviteMember`, `acceptInvite`,
  `revokeInvitation`, `removeMember`, `updateMemberRole`.
- **Vérifier** : parcours invite→email→register→accept→dashboard de bout en bout.

### Étape 7 — Gating réel du flag (fermer la dette)
- Le gate vit dans `POST /api/team/invite` (Étape 3.2). `isFeatureAllowed(plan,
  "multiUser")` gagne enfin un caller → dette "flag jamais lu" résolue (même nature
  que la note Phase 11). Rien d'autre à câbler.

### Étape 8 — Docs
- `docs/architecture.md` :
  - Ajouter `org_invitations` au schéma Postgres + l'enum `invitation_status`.
  - Documenter le modèle RBAC (1 user = 1 org, rôles owner/admin/member,
    autorisation lue depuis `users.role`).
  - Déplacer "Phase 10" de la roadmap vers une section "Multi-user / RBAC".

### Étape 9 — Tests
- Intégration (`apps/api`) :
  - non-business invite → `403 plan_locked_feature`,
  - business owner/admin invite → `200` ; `member` invite → `403 forbidden_role`,
  - accept token valide → `users.orgId` ré-assigné + rôle posé,
  - accept email mismatch → `403` ; token expiré/révoqué → `410`/`404`,
  - retrait du dernier owner → `403 cannot_remove_owner`,
  - cleanup : invité avec ancien workspace solo sans sub → ancien org supprimé,
  - isolation : accepter l'org A ne donne aucun accès à l'org B.
- **Vérifier** : `pnpm test` vert + `pnpm typecheck`.

---

## Fichiers touchés (récap)

**Créés**
- `packages/db/src/schema/invitations.ts` (table + enum)
- `apps/api/src/middleware/require-role.ts`
- `apps/api/src/routes/team.ts`
- `apps/api/src/lib/resend.ts` (si extraction préférée au `fetch` direct)
- `apps/web/src/app/dashboard/settings/team/page.tsx`
- `apps/web/src/app/(auth)/invite/page.tsx`

**Modifiés**
- `packages/db/src/schema/index.ts` (barrel : `export * from "./invitations"`)
- `apps/api/src/lib/org.ts` (`getUserMembership`)
- `apps/api/src/index.ts` (montage `/api/team`)
- `apps/web/src/lib/api.ts` (helpers team)
- `apps/web/src/components/dashboard/settings-nav.tsx` (entrée "Team")
- `docs/architecture.md` (schéma + RBAC + retrait roadmap)

**Inchangé mais déterminant**
- `packages/shared/src/constants/plans.ts` — `features.multiUser` déjà `true` pour business.
- `apps/api/src/lib/plan.ts` — `isFeatureAllowed` réutilisé tel quel (gagne un caller).
- `packages/db/src/schema/users.ts` — `orgId` + `roleEnum` déjà présents, **non modifiés**.
- Toutes les routes en `ensureUserOrg(user.id)` — **non touchées** (intérêt du modèle 1:1).

---

## Points d'attention

- **`role` enfin load-bearing** : aujourd'hui `users.role` est posé (`owner` par
  `ensureUserOrg`, `member` par défaut Better Auth) mais **jamais lu**. Vérifier que
  tout user existant a un `role` cohérent avant de l'utiliser pour de l'autz
  (les `ensureUserOrg` passés ont déjà mis `owner` aux fondateurs).
- **Owner unique** : au MVP, une org a exactement un `owner` (le créateur).
  Interdire de le retirer/rétrograder s'il est le dernier. **Transfert d'ownership
  = hors scope** (à ajouter si besoin : `PATCH /api/team/members/:id { role:'owner' }`
  qui rétrograde l'ancien owner).
- **Cleanup d'org payante** : ne JAMAIS supprimer un org avec `stripeSubscriptionId`
  à l'accept (cf. Étape 4) — risque de tuer un abonnement actif par effet de bord.
- **Isolation cross-tenant** : le risque #1. L'accept est la seule route qui change
  l'org d'un user — la border-checker (email match + token valide) doit être stricte.
- **Pas de seats facturés** : le gate binaire suffit au MVP. Si facturation au siège
  plus tard → ajouter `maxSeats` à `PlanLimits` + check dans `POST /api/team/invite`
  (count `users where orgId` + invitations pending vs `maxSeats`). Ne pas le faire
  maintenant (Karpathy — simplicity first).
- **Better Auth `user.create.after`** (`apps/api/src/lib/auth.ts`) insère dans
  `users` sans `orgId` — parfait pour un invité : il ne reçoit un workspace perso
  que s'il atteint le dashboard avant d'accepter, et l'Étape 4 nettoie ce cas.
- **`api` (Phase 11)** : aussi `true` pour business, aussi jamais checké. Indépendant,
  mais si les deux phases atterrissent ensemble, les clés API restent liées au user →
  l'org dérive de `users.orgId`, donc compatibles sans changement.
