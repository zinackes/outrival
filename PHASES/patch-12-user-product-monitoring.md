# Patch 12 — Monitoring du produit utilisateur

<context>
Aujourd'hui le productProfile de l'utilisateur est extrait UNE fois à l'onboarding,
stocké brutalement sur l'org, et jamais ré-évalué. Quatre champs vagues
(catégorie, audience, valeur, modèle de pricing). Le site du user n'est
JAMAIS scrapé après l'onboarding.

Résultat : asymétrie majeure d'information. Outrival connaît ses concurrents
en détail (Phase 5 : pricing, features, jobs, reviews, stack), mais sait
quasiment rien du produit user. Les battle cards, signals et insights sont
bancals.

Ce patch comble ce trou en traitant le site user comme un "concurrent spécial" :
- Self-competitor (type = "self") créé automatiquement à la fin de l'onboarding
- Pipeline d'enrichissement complet (Phase 5) appliqué au site user
- Page "Mon produit" éditable où le user voit et corrige ce qu'on a extrait
- Re-scan périodique avec notifications de changement à valider
- Re-discovery automatique si changement profond du profil

Principe central : SYMÉTRIE D'INFORMATION. Le user a une fiche aussi riche
sur lui-même que sur ses concurrents. L'IA propose, le user valide ou corrige.

Pas implémenté ici (en Later) :
- Multi-produit (Notion avec plusieurs SKU côté user aussi)
- Comparaison automatique périodique (auto-générer battle card refresh)

Lire avant : @CLAUDE.md, @docs/architecture.md, @PHASES/05-enrichissement.md
(pipeline d'enrichissement à réutiliser), @PHASES/04-competitor-discovery.md
(onboarding), @PHASES/patch-08-onboarding-stages.md, @PHASES/patch-11-pricing-detection.md
(taxonomie pricing), @apps/web/CLAUDE.md, @apps/api/CLAUDE.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env

Pas de nouvelle dépendance. Pas de nouvelle variable d'env.

Ajouter (optionnel, configurable) :
```
USER_PRODUCT_RESCAN_DAYS=14    # fréquence par défaut du re-scan du site user
```

→ vérifier : env lue côté workers

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Schéma : le competitor "self"

### packages/db/src/schema/competitors.ts

Étendre la table competitors existante :
```typescript
type: text("type").notNull().default("competitor"),
//        "competitor" | "self"
isUserProduct: boolean("is_user_product").notNull().default(false),
//        true si type = "self"  (redondant mais utile pour les requêtes)
```

(Si l'enum est strict dans Phase 5, étendre l'enum pour accepter "self".)

### Métadonnées d'extraction (pour la transparence "détecté auto / édité")

Sur les champs riches extraits par Phase 5 (sur la table competitor_profiles
ou équivalent, à adapter selon le schéma réel) :
```typescript
isFromAutoDetect: boolean("is_from_auto_detect").notNull().default(true),
lastEditedByUserAt: timestamp("last_edited_by_user_at"),
```

Permet l'UI "détecté auto / corrigé par vous" + indication de la dernière édition manuelle.

### Notifications de changement self

Nouvelle table dédiée pour les changements détectés sur le site user (distincte
des signals classiques) :

```typescript
// packages/db/src/schema/self-product-changes.ts
import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

export const selfChangeStatusEnum = pgEnum("self_change_status", [
  "pending",       // détecté, en attente de la décision du user
  "accepted",      // user a validé → profil mis à jour
  "modified",      // user a édité manuellement plutôt qu'accepter
  "ignored",       // user a explicitement ignoré
]);

export const selfChangeSeverityEnum = pgEnum("self_change_severity", [
  "minor",         // ex: prix d'un tier modifié
  "major",         // ex: nouvelle catégorie, nouvelle audience, repositionnement
]);

export const selfProductChanges = pgTable("self_product_changes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  selfCompetitorId: text("self_competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  fieldPath: text("field_path").notNull(),  // ex: "pricing.tiers[1].price", "features", "valueProposition"
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  severity: selfChangeSeverityEnum("severity").notNull(),
  status: selfChangeStatusEnum("status").notNull().default("pending"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});
```

Ajouter au schema/index.ts. pnpm db:push --filter @outrival/db

→ vérifier : tables créées dans Drizzle Studio

Commit : `feat(db): add self competitor type and product changes tracking`

---

## Étape 2 — Création auto du self-competitor en fin d'onboarding

### apps/api/src/routes/onboarding.ts

À la fin de POST /api/onboarding/complete (ou équivalent existant), juste après
la création des concurrents sélectionnés :

```typescript
// Création du self-competitor UNIQUEMENT si on a une URL (modes "live" et "developing")
// Les modes "idea" et "document" n'ont pas d'URL → pas de self-competitor pour l'instant
const userUrl = org.productUrl; // URL stockée lors de l'onboarding mode "live"
const repoUrl = org.productRepoUrl; // URL repo si mode "developing"

const monitorableUrl = userUrl ?? null;  // priorité à l'URL produit

if (monitorableUrl) {
  const [selfCompetitor] = await db.insert(competitors).values({
    organizationId: org.id,
    url: monitorableUrl,
    name: org.productName ?? "Mon produit",
    type: "self",
    isUserProduct: true,
    // pas de overlap_score, pas de discovery_source — c'est nous
  }).returning();

  // Lancer le pipeline d'enrichissement complet (Phase 5)
  await enrichCompetitorJob.trigger({ competitorId: selfCompetitor.id, isFirstRun: true });
}
```

Pour les modes "idea" et "document" : pas de self-competitor maintenant. Quand le
user obtiendra une URL plus tard (re-onboarding mode "live"), le self-competitor
sera créé à ce moment. Documenter ce comportement dans findings.md.

→ vérifier : un onboarding mode "live" termine → competitor type="self" existe
→ vérifier : un onboarding mode "idea" → AUCUN self-competitor, juste le profil
→ vérifier : pipeline d'enrichissement déclenché en arrière-plan

Commit : `feat(api): auto-create self competitor at end of onboarding`

---

## Étape 3 — Pipeline d'enrichissement adapté au self-competitor

### apps/workers/src/jobs/enrich-competitor.job.ts (Phase 5)

Le pipeline existant scrape pricing, features, jobs, reviews. Il fonctionne tel
quel pour le self-competitor, sauf deux ajustements :

**a. Skip des reviews G2/Capterra**

Le user est probablement trop early-stage pour avoir des reviews. Skipper cette
étape si type = "self" pour économiser un appel proxy coûteux (G2/Capterra
nécessitent ScrapingBee).

```typescript
if (competitor.type !== "self") {
  await scrapeReviews(competitor);
}
```

**b. Marquer les extractions comme isFromAutoDetect = true**

Pour que l'UI puisse afficher "détecté automatiquement, à valider".

→ vérifier : un enrichissement du self-competitor → pricing + features + jobs
  extraits, pas de reviews tentées, isFromAutoDetect = true partout
→ vérifier : un enrichissement d'un concurrent classique → comportement inchangé

Commit : `feat(workers): adapt enrichment pipeline for self competitor`

---

## Étape 4 — Adapter scrape-monitor : pas de signals classiques pour le self

### apps/workers/src/jobs/scrape-monitor.job.ts

Aujourd'hui scrape-monitor détecte des changements et les transforme en signals
via le pipeline IA. Pour le self-competitor, on ne veut PAS générer de signals
dans signal_feed (l'user ne veut pas voir des alertes sur lui-même), mais on
veut créer des entrées dans self_product_changes.

```typescript
// À l'endroit où, après diff + classification, on génère un Signal :

if (competitor.type === "self") {
  // Créer une entrée self_product_changes au lieu d'un signal
  const severity = determineSelfChangeSeverity(diff, classification);
  await db.insert(selfProductChanges).values({
    orgId: competitor.organizationId,
    selfCompetitorId: competitor.id,
    fieldPath: classification.fieldPath ?? "unknown",
    previousValue: diff.before,
    newValue: diff.after,
    severity,
    status: "pending",
  });

  // Notifier le user via les canaux existants (in-app + email si configuré)
  await notifySelfChange(competitor.organizationId, severity);
  return;
}

// sinon, comportement classique : générer un signal
await generateSignalJob.trigger({ ... });
```

### Helper determineSelfChangeSeverity (apps/workers/src/lib/)

```typescript
export function determineSelfChangeSeverity(
  diff: DiffResult,
  classification: Classification,
): "minor" | "major" {
  // Changements majeurs : repositionnement, nouvelle catégorie, nouvelle audience
  if (classification.type === "category_change") return "major";
  if (classification.type === "audience_change") return "major";
  if (classification.type === "positioning_change") return "major";
  if (classification.type === "pricing_status_transition") return "major";  // patch-11

  // Le reste = mineur (ajout/suppression feature, ajustement prix, etc.)
  return "minor";
}
```

→ vérifier : changement sur self-competitor → entrée self_product_changes, AUCUN signal
→ vérifier : changement sur concurrent classique → signal généré normalement

Commit : `feat(workers): route self competitor changes to self_product_changes`

---

## Étape 5 — API : page "Mon produit"

### apps/api/src/routes/my-product.ts

Routes dédiées au self-competitor (toutes authMiddleware) :

```
GET /api/my-product
  → retourne le self-competitor enrichi : profil, pricing, features, jobs,
    avec les flags isFromAutoDetect + lastEditedByUserAt par champ
  → null si pas encore créé (modes "idea"/"document" sans URL)

PATCH /api/my-product
  → édition manuelle des champs
  → met isFromAutoDetect = false + lastEditedByUserAt = now()
  → log d'audit pour traçabilité

POST /api/my-product/rescan
  → trigger enrich-competitor en force pour le self-competitor
  → retourne { ok }

GET /api/my-product/changes?status=pending
  → liste des self_product_changes en attente

POST /api/my-product/changes/:id/accept
  → applique le newValue au profil + marque la change "accepted"
  → si severity = "major" → suggérer re-discovery (voir étape 7)

POST /api/my-product/changes/:id/modify
  → permet d'éditer manuellement au lieu d'accepter le newValue brut
  → marque "modified"

POST /api/my-product/changes/:id/ignore
  → marque "ignored", profil non modifié
```

→ vérifier : GET retourne le profil complet
→ vérifier : PATCH édite et marque correctement (isFromAutoDetect false)
→ vérifier : POST rescan déclenche le pipeline
→ vérifier : accept/modify/ignore mettent à jour les statuts

Commit : `feat(api): add my-product endpoints with edit and change resolution`

---

## Étape 6 — UI : page "Mon produit"

### apps/web/src/app/(dashboard)/my-product/page.tsx

Nouvelle entrée dans la nav principale (à côté de "Concurrents") : **"Mon produit"**.

Mise en page :

```
┌─ Mon produit ─────────────────────────────────────────────────┐
│                                                                 │
│  outrival.io · Dernier scan : il y a 2 jours · [Re-scanner]   │
│                                                                 │
│  ── Profil ──                                                   │
│  Catégorie         B2B SaaS · Competitive Intelligence         │
│                    [✏ Modifier]  ⓘ détecté auto                │
│  Audience          Fondateurs SaaS, PMs (1-50 personnes)       │
│                    [✏ Modifier]  ⓘ corrigé par vous le 12 mai  │
│  Valeur            Veille concurrentielle abordable + IA       │
│                    [✏ Modifier]                                 │
│                                                                 │
│  ── Pricing ──                                                  │
│  Statut            Public (4 tiers)                            │
│  Free              0€                                          │
│  Starter           29€/mois                                    │
│  Pro               79€/mois                                    │
│  Business          199€/mois                                   │
│  [✏ Modifier]  ⓘ détecté auto · vu depuis FR                  │
│                                                                 │
│  ── Features détectées (8) ──                                   │
│  ✓ Découverte automatique         ✓ Multi-source monitoring   │
│  ✓ Insights IA                    ✓ Battle cards              │
│  ✓ Alertes temps-réel             ✓ Digest hebdo              │
│  ✓ Multi-onboarding               ✓ Free tier                 │
│  [+ Ajouter]  [✏ Modifier]  ⓘ détecté auto                    │
│                                                                 │
│  ── Stack technique détectée ──                                 │
│  Next.js · Hono · PostgreSQL · ClickHouse · Stripe             │
│  [✏ Modifier]                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Section "Changements détectés"

En haut de la page si des self_product_changes pending existent :

```
┌─ 3 changements détectés sur votre site ──────────────────────┐
│                                                                │
│  🟡 Pricing                                                    │
│     Le tier "Pro" est passé de 79€ → 69€/mois                │
│     [Accepter]  [Modifier]  [Ignorer]                         │
│                                                                │
│  🟢 Features                                                   │
│     Nouvelle feature détectée : "AI-powered autocomplete"     │
│     [Accepter]  [Modifier]  [Ignorer]                         │
│                                                                │
│  🔴 Catégorie (majeur)                                         │
│     Catégorie : "Competitive Intelligence" → "Sales Intelligence"│
│     ⚠ Ce changement est majeur — vos concurrents pourraient   │
│       devoir être réévalués.                                   │
│     [Accepter et re-scanner]  [Modifier]  [Ignorer]           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

Design Outrival (dark, amber, Geist Mono pour chiffres, lucide-react icons).

→ vérifier : la page affiche le profil complet du self-competitor
→ vérifier : édition d'un champ → marque isFromAutoDetect = false
→ vérifier : pending changes affichés avec actions (accept/modify/ignore)
→ vérifier : un user en mode "idea" (pas d'URL) voit un message "Pas de site
  à monitorer. [Mettre à jour vers mode URL]" qui ramène à l'onboarding

Commit : `feat(web): add my-product page with editable profile and changes`

---

## Étape 7 — Re-discovery sur changement majeur

### apps/api/src/routes/my-product.ts (extension de POST accept)

Quand une self_product_change de severity = "major" est acceptée :

```typescript
// dans accept handler
if (change.severity === "major") {
  // Proposer (pas imposer) une re-discovery
  return c.json({
    ok: true,
    suggestion: {
      action: "rediscover",
      reason: "Votre profil a changé significativement. Vos concurrents pourraient devoir être réévalués.",
    },
  });
}
```

### UI : modal de confirmation après acceptation d'un changement majeur

```
┌─ Re-évaluer vos concurrents ? ───────────────────────────────┐
│                                                                │
│  Votre catégorie est passée de "Competitive Intelligence"     │
│  à "Sales Intelligence".                                       │
│                                                                │
│  Certains de vos concurrents actuels pourraient être moins     │
│  pertinents, et de nouveaux pourraient apparaître.             │
│                                                                │
│  [Lancer une re-discovery]  [Ne pas changer]                  │
└────────────────────────────────────────────────────────────────┘
```

Si l'user clique "Lancer une re-discovery" → POST /api/onboarding/discover en
mode "re-scoring" :
- Re-score les concurrents existants avec le nouveau profil
- Lance Exa.ai avec le nouveau profil → propose de nouveaux concurrents
- Ne supprime AUCUN concurrent existant automatiquement (l'user reste maître)
- Affiche les résultats dans une vue "Re-discovery" avec les concurrents existants
  ré-évalués + les nouveaux suggérés

→ vérifier : accept d'une change "major" → modal de re-discovery proposée
→ vérifier : accept d'une change "minor" → pas de modal, juste accept
→ vérifier : re-discovery préserve les concurrents existants (juste re-score)

Commit : `feat(api): suggest rediscovery on major profile changes`

---

## Étape 8 — Re-scan périodique du self-competitor

### apps/workers/src/jobs/schedule-scraping.job.ts (du patch-01)

Le job de schedule existant tourne déjà toutes les heures et ramasse les monitors
dus. Le self-competitor est juste un competitor de plus, donc il sera scrapé
automatiquement selon sa fréquence configurée.

S'assurer qu'à la création du self-competitor (étape 2), les monitors associés
ont une fréquence par défaut adaptée :
- USER_PRODUCT_RESCAN_DAYS env (défaut 14 jours)

Surgical : ajouter dans la création du self-competitor (étape 2) la création
des monitors avec cette fréquence. La logique adaptative du patch-01 prendra
le relais (si le site change peu, espacement automatique).

→ vérifier : self-competitor scrapé selon la fréquence configurée
→ vérifier : si le user clique "Re-scanner maintenant", le scrape se déclenche
  immédiatement indépendamment du schedule

Commit : `feat(workers): periodic rescan of user product site`

---

## Étape 9 — Cohérence cross-feature

### Vérifier que les autres features se comportent correctement avec type = "self"

**Discovery (Phase 4)** :
- Le self-competitor NE doit JAMAIS apparaître dans les résultats de discovery
- Si Exa.ai retourne par hasard le domaine de l'user, le filtrer côté backend

**Liste des concurrents (dashboard principal)** :
- Le self-competitor NE doit PAS apparaître dans la liste "Mes concurrents"
- Filtre : WHERE type = 'competitor' AND organizationId = ?

**Battle cards** :
- Le self-competitor est utilisable comme "côté nous" dans les battle cards
- Le rendu battle card lit le profil du self-competitor + d'un competitor pour générer la fiche

**Patch-02 admin ops** :
- Compter le self-competitor dans les stats d'org est OK
- Ne pas le compter comme un "concurrent surveillé" dans les quotas (Phase 7)

**Patch-09 cache IA** :
- Fonctionne pareil, aucun ajustement nécessaire

**Patch-11 pricing** :
- Le pricing du self-competitor utilise la même taxonomie
- Si statut "unknown" → bouton override manuel disponible (déjà dans patch-11)

→ vérifier chaque point individuellement avec un test

Commit : `fix: ensure self competitor is excluded from discovery and competitor list`

---

## Étape 10 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test end-to-end :

1. **Création auto** : nouvel onboarding mode "live" avec URL → self-competitor existe + enrichissement déclenché
2. **Profil riche** : page /my-product affiche pricing, features, stack avec flags "détecté auto"
3. **Édition** : modifier la catégorie → isFromAutoDetect = false + lastEditedByUserAt mis à jour
4. **Re-scan manuel** : bouton "Re-scanner" déclenche enrich-competitor
5. **Changement détecté** : forcer une modification du site fictif → self_product_changes pending
6. **Acceptation** : accepter un changement → profil mis à jour + change "accepted"
7. **Modification** : modifier au lieu d'accepter → champ édité manuellement
8. **Ignore** : ignorer un changement → status "ignored", profil intact
9. **Changement majeur** : accepter une change "major" → modal de re-discovery
10. **Re-discovery** : lancer → concurrents existants re-scorés + nouveaux suggérés
11. **Exclusion discovery** : self-competitor n'apparaît jamais comme suggestion
12. **Mode "idea"** : pas de self-competitor, message d'invitation à passer en mode URL
13. **Reviews** : pas de scrape G2/Capterra sur le self-competitor (économie proxy)
14. **Signals classiques** : un changement sur le self ne crée AUCUN signal (juste self_product_changes)

Mettre à jour findings.md :
- Cas observés (faux positifs auto-détection, fréquence des changements majeurs)
- Patterns de changements les plus courants
- Ajustements de severity (minor vs major)

task_plan.md : patch-12 → complete.
</task>

<constraints>
- Le self-competitor a type = "self" et isUserProduct = true (les deux pour faciliter requêtes)
- Le self-competitor n'apparaît JAMAIS dans la discovery (filtrer Exa) ni dans la liste de concurrents
- Les changements détectés sur le self vont dans self_product_changes, JAMAIS dans signal_feed
- Le pipeline d'enrichissement skip les reviews G2/Capterra pour le self (économie proxy)
- TOUS les champs extraits automatiquement sont marqués isFromAutoDetect = true
- L'édition manuelle marque isFromAutoDetect = false + lastEditedByUserAt = now()
- L'UI distingue visuellement "détecté auto" et "corrigé par vous"
- Re-discovery est PROPOSÉE sur changement majeur, jamais imposée
- Modes "idea" et "document" (sans URL) : pas de self-competitor pour l'instant,
  message invitant à passer en mode URL pour activer le monitoring
- Le user reste TOUJOURS maître de ses concurrents (re-discovery ne supprime rien)
- Surgical : étendre les schémas et pipelines existants sans réécrire
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@PHASES/04-competitor-discovery.md
@PHASES/05-enrichissement.md
@PHASES/patch-01-scraping-cost.md (frequence adaptative)
@PHASES/patch-08-onboarding-stages.md (modes d'onboarding)
@PHASES/patch-11-pricing-detection.md (taxonomie pricing)
@apps/web/CLAUDE.md
@apps/api/CLAUDE.md
@apps/workers/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Schéma étendu (type "self", isUserProduct, isFromAutoDetect, self_product_changes)
✓ Self-competitor créé auto à la fin de l'onboarding (modes avec URL)
✓ Pipeline d'enrichissement adapté (skip reviews pour le self)
✓ Page /my-product affiche le profil complet avec flags d'auto-détection
✓ Édition manuelle marque correctement isFromAutoDetect false
✓ Changements détectés vont dans self_product_changes, AUCUN signal généré
✓ Accept/modify/ignore fonctionnent et résolvent les changes
✓ Changement majeur accepté → modal de re-discovery proposée
✓ Re-discovery préserve les concurrents existants (re-score, pas suppression)
✓ Self-competitor exclu de la discovery et de la liste de concurrents
✓ Modes "idea"/"document" sans URL : message d'invitation, pas de self-competitor
✓ Re-scan périodique selon USER_PRODUCT_RESCAN_DAYS
✓ Bouton "Re-scanner maintenant" déclenche scrape immédiat
✓ task_plan.md patch-12 = complete
</verification>

<commit>
feat(db): add self competitor type and product changes tracking
feat(api): auto-create self competitor at end of onboarding
feat(workers): adapt enrichment pipeline for self competitor
feat(workers): route self competitor changes to self_product_changes
feat(api): add my-product endpoints with edit and change resolution
feat(web): add my-product page with editable profile and changes
feat(api): suggest rediscovery on major profile changes
feat(workers): periodic rescan of user product site
fix: ensure self competitor is excluded from discovery and competitor list
</commit>