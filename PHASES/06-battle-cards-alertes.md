# Phase 6 — Battle Cards & Alertes

<context>
Les Phases 1 à 5 sont terminées : monorepo, auth, scraping autonome,
pipeline IA, alertes Slack/email, digest, découverte de concurrents,
enrichissement (jobs/reviews/pricing) et fiche concurrent complète.

Cette phase ajoute trois choses :
1. Battle cards auto-générées par concurrent (forces/faiblesses, objections,
   quand on gagne/perd) + export PDF
2. Alertes in-app temps-réel via SSE (Server-Sent Events) — pas de service
   payant, tourne sur le VPS. Complète les alertes Slack/email existantes.
3. "Nouveau concurrent détecté" : un job hebdo qui re-run la discovery et
   alerte si un nouvel acteur apparaît dans l'espace de l'utilisateur.

CHOIX D'ARCHITECTURE pour le temps-réel : on utilise SSE (DB-backed) plutôt
qu'Upstash pub/sub. C'est plus simple, 100% gratuit, tourne sur le VPS, et
une latence de 2-3s est largement suffisante pour de la veille. Upstash reste
pour le rate limiting / cache.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/skills/ai-pipeline/SKILL.md
- @.claude/skills/trigger-jobs/SKILL.md
- @.claude/skills/crawlee-patterns/SKILL.md
- @packages/ai/CLAUDE.md
- @packages/db/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- Chaque concurrent peut avoir une battle card auto-générée et éditable
- La battle card est exportable en PDF (stocké sur R2)
- Une cloche de notifications affiche les alertes in-app en temps quasi-réel (SSE)
- Un job hebdo détecte les nouveaux concurrents et crée une notification
- L'utilisateur peut ajouter ou ignorer un concurrent détecté
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances

```bash
# apps/web : rien de nouveau majeur (SSE natif via EventSource)
# apps/workers : Playwright déjà présent (utilisé pour le PDF)
# apps/api : rien de nouveau (Hono a streamSSE intégré)
```

Aucune nouvelle dépendance. Le PDF utilise Playwright (déjà installé Phase 2),
le temps-réel utilise SSE natif (EventSource côté navigateur, streamSSE côté Hono).

Commit : (pas de commit pour cette étape — passer directement à l'étape 1)

---

## Étape 1 — Schéma : battle_cards, notifications, candidates

### packages/db/src/schema/battle-cards.ts
```typescript
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";
import { organizations } from "./organizations";

export const battleCards = pgTable("battle_cards", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  content: jsonb("content").notNull(), // structure éditée par l'utilisateur
  pdfR2Key: text("pdf_r2_key"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### packages/db/src/schema/notifications.ts
```typescript
import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const notificationTypeEnum = pgEnum("notification_type", [
  "signal", "new_competitor"
]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  linkUrl: text("link_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### packages/db/src/schema/competitor-candidates.ts
```typescript
import { pgTable, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const candidateStatusEnum = pgEnum("candidate_status", [
  "new", "dismissed", "added"
]);

export const competitorCandidates = pgTable("competitor_candidates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  overlapScore: real("overlap_score"),
  reason: text("reason"),
  status: candidateStatusEnum("status").notNull().default("new"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
});
```

Ajouter au schema/index.ts. Puis : pnpm db:push --filter @outrival/db

→ vérifier : les 3 tables existent dans Drizzle Studio

Commit : `feat(db): add battle_cards, notifications, candidates tables`

---

## Étape 2 — packages/ai : génération de battle card

### packages/ai/src/tasks/battle-card.ts
Via Groq (AI_CONFIG.insights). Suivre @.claude/skills/ai-pipeline/SKILL.md.
```typescript
import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

const BattleCardSchema = z.object({
  their_strengths: z.array(z.string()).max(5),
  our_strengths: z.array(z.string()).max(5),
  their_weaknesses: z.array(z.string()).max(5),
  common_objections: z.array(z.object({
    objection: z.string(),
    response: z.string(),
  })).max(5),
  when_we_win: z.array(z.string()).max(4),
  when_we_lose: z.array(z.string()).max(4),
});

export type BattleCardContent = z.infer;

export async function generateBattleCard(input: {
  myProduct: { category: string; valueProp: string };
  competitorName: string;
  competitorSummary: string | null;
  reviewComplaints: string[];
  reviewPraises: string[];
  recentSignals: Array;
}): Promise {
  const prompt = `
Catégorie : ${input.myProduct.category}
Valeur : ${input.myProduct.valueProp}



Nom : ${input.competitorName}
Résumé : ${input.competitorSummary ?? "inconnu"}
Ce que ses clients adorent : ${input.reviewPraises.join("; ")}
Ce dont ses clients se plaignent : ${input.reviewComplaints.join("; ")}
Signaux récents : ${input.recentSignals.map((s) => s.insight).join("; ")}



Génère une battle card commerciale pour m'aider à gagner face à ce concurrent.
Sois concret et actionnable. Réponds UNIQUEMENT en JSON valide, sans markdown.


Format :
{
  "their_strengths": ["..."],
  "our_strengths": ["..."],
  "their_weaknesses": ["..."],
  "common_objections": [{ "objection": "...", "response": "..." }],
  "when_we_win": ["..."],
  "when_we_lose": ["..."]
}`;

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, BattleCardSchema);
  if (!result.ok) {
    console.error("Battle card generation failed:", result.error);
    return null;
  }
  return result.value;
}
```

Réexporter depuis packages/ai/src/index.ts.

→ vérifier : pnpm typecheck --filter @outrival/ai

Commit : `feat(ai): add battle card generation task`

---

## Étape 3 — Workers : job battle card + PDF

### apps/workers/src/lib/battle-card-html.ts
Fonction qui transforme une BattleCardContent en HTML stylé (template
imprimable, design Outrival dark/amber, format A4).

### apps/workers/src/jobs/generate-battle-card.job.ts
Input : { competitorId, orgId }
```
1. Récupérer : profil produit de l'org, competitor + aiSummary,
   dernier review summary (praises/complaints), derniers signals
2. generateBattleCard(...) → contenu structuré
3. Si null → AbortTaskRunError
4. Upsert dans battle_cards (content)
5. Rendre le HTML via battle-card-html
6. Playwright : charger le HTML, page.pdf({ format: "A4" })
7. Upload PDF sur R2 : battle-cards/{competitorId}/{ISO_timestamp}.pdf
8. Update battle_cards.pdfR2Key
9. context.log
```

→ vérifier : déclencher le job → battle_cards rempli + PDF dans R2

Commit : `feat(workers): add battle card generation with PDF export`

---

## Étape 4 — API : battle card

### apps/api/src/routes/battle-cards.ts
Protégées par authMiddleware + vérification ownership.
```
GET /api/competitors/:id/battle-card
  → battle card existante (ou 404 si pas encore générée)

POST /api/competitors/:id/battle-card/generate
  → trigger generate-battle-card.job
  → retourner { status: "generating" }

PATCH /api/competitors/:id/battle-card
  body: { content }
  → mettre à jour le contenu édité par l'utilisateur
  → ne PAS régénérer le PDF automatiquement (bouton séparé)

GET /api/competitors/:id/battle-card/pdf
  → récupérer le PDF depuis R2 (pdfR2Key) et le streamer
  → ou retourner une URL présignée
```

Enregistrer le router dans index.ts.

→ vérifier : générer une battle card via l'API → récupérable + PDF téléchargeable

Commit : `feat(api): add battle card endpoints with PDF download`

---

## Étape 5 — UI : onglet Battle Card

### apps/web/src/app/(dashboard)/competitors/[id]/page.tsx
Ajouter un onglet "Battle Card" à la fiche concurrent.

- Si aucune battle card : bouton "Générer la battle card"
  → POST .../generate → polling léger jusqu'à disponibilité (toutes les 3s)
- Si battle card existante : afficher les sections :
  - Leurs forces / Nos forces (2 colonnes)
  - Leurs faiblesses
  - Objections fréquentes (objection → réponse)
  - Quand on gagne / Quand on perd (2 colonnes)
- Mode édition : champs éditables → PATCH content
- Bouton "Régénérer" (relance le job)
- Bouton "Télécharger PDF" → GET .../pdf

Design Outrival (dark, amber, Syne + Inter, shadcn new-york).

→ vérifier : générer, éditer, télécharger le PDF depuis l'UI

Commit : `feat(web): add battle card tab with edit and PDF export`

---

## Étape 6 — Alertes in-app temps-réel (SSE)

### apps/workers — créer les notifications
Modifier send-alert.job.ts (Phase 3) : en plus de Slack/email, créer une
ligne dans la table notifications (type "signal").
Surgical : ajouter uniquement la création de notification.

### apps/api/src/routes/notifications.ts
```
GET /api/notifications
  → notifications de l'org, ordonnées par createdAt desc, limit 50

GET /api/notifications/unread-count
  → nombre de non-lues

PATCH /api/notifications/:id/read
POST /api/notifications/read-all

GET /api/notifications/stream   (SSE)
  → flux Server-Sent Events
  → utiliser streamSSE de Hono
  → côté serveur : interroger les notifications non-vues de l'org
    toutes les 2-3s, pousser les nouvelles au client
  → garder la connexion ouverte, heartbeat régulier
```

Exemple SSE Hono :
```typescript
import { streamSSE } from "hono/streaming";

notificationsRouter.get("/stream", authMiddleware, (c) => {
  const orgId = c.get("user").orgId;
  return streamSSE(c, async (stream) => {
    let lastCheck = new Date();
    while (true) {
      const fresh = await db.query.notifications.findMany({
        where: and(eq(notifications.orgId, orgId), gt(notifications.createdAt, lastCheck)),
      });
      for (const n of fresh) {
        await stream.writeSSE({ data: JSON.stringify(n), event: "notification" });
      }
      lastCheck = new Date();
      await stream.sleep(3000);
    }
  });
});
```

### apps/web — cloche de notifications
- Composant Bell dans le header dashboard (icône lucide-react Bell)
- Badge avec le nombre de non-lues
- Dropdown : liste des notifications récentes, clic → linkUrl
- Connexion SSE via EventSource à /api/notifications/stream
  → à la réception d'un event "notification" : incrémenter le badge + toast
- Bouton "tout marquer comme lu"

→ vérifier : générer un signal critical → la cloche s'update en ~3s sans refresh

Commit : `feat(notifications): add in-app real-time alerts via SSE`

---

## Étape 7 — "Nouveau concurrent détecté"

### apps/workers/src/jobs/detect-new-competitors.job.ts
Tâche schedulée (hebdo, ex: dimanche soir `0 20 * * 0`).
```
1. Pour chaque org avec un productUrl :
2. findSimilarCompanies(productUrl, 20)
3. Filtrer : exclure les concurrents déjà suivis (competitors actifs)
4. Filtrer : exclure les candidates déjà vus (competitor_candidates)
5. Scorer l'overlap (scoreOverlap)
6. Pour chaque nouveau candidat avec overlap > 65 :
   - insert dans competitor_candidates (status "new")
   - créer une notification (type "new_competitor") :
     "Nouveau concurrent détecté : {nom} (overlap {score}%)"
7. context.log du nombre de nouveaux détectés
```

### apps/api/src/routes/candidates.ts
```
GET /api/candidates
  query: ?status=new
  → candidats détectés

POST /api/candidates/:id/add
  → créer le competitor + monitors (réutiliser logique Phase 2)
  → set candidate.status = "added"

POST /api/candidates/:id/dismiss
  → set candidate.status = "dismissed"
```

### apps/web — UI candidats
- Page ou section "Concurrents détectés" (badge si des "new" existent)
- Pour chaque candidat : nom, overlap, reason
  - Bouton "Ajouter à ma veille" → POST .../add
  - Bouton "Ignorer" → POST .../dismiss
- La notification "new_competitor" pointe vers cette page

→ vérifier : déclencher manuellement detect-new-competitors → candidats + notif créés
→ vérifier : ajouter un candidat le transforme en concurrent suivi

Commit : `feat(workers): add new competitor detection with candidates flow`

---

## Étape 8 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm dev && pnpm trigger:dev
```

Test end-to-end :
1. Sur un concurrent enrichi, générer une battle card → contenu cohérent
2. Éditer une section → sauvegarde OK
3. Télécharger le PDF → fichier propre et stylé
4. Générer un signal critical → la cloche s'update en ~3s (SSE) + toast
5. Marquer les notifications comme lues
6. Déclencher detect-new-competitors → notification "nouveau concurrent"
7. Ouvrir la page candidats → ajouter un candidat → devient un concurrent suivi
8. Ignorer un candidat → disparaît de la liste

---

## Étape 9 — Mettre à jour le planning

task_plan.md :
- Phase 6 Battle Cards & Alertes → complete ✓
- Phase 7 Monétisation → in_progress (prochaine)

findings.md :
- Qualité des battle cards générées par Groq
- Fidélité du rendu PDF Playwright
- Comportement SSE (stabilité connexion, reconnexion, latence réelle)
- Pertinence de la détection de nouveaux concurrents

progress.md : log de session.
</task>

<constraints>
- Battle cards générées via Groq (AI_CONFIG.insights)
- PDF généré via Playwright (déjà installé) → stocké sur R2, jamais en DB
- Temps-réel via SSE (DB-backed), PAS d'Upstash pub/sub ni service payant
- Le PDF ne se régénère PAS automatiquement à chaque édition (bouton séparé)
- Ne pas implémenter Stripe / billing (Phase 7)
- detect-new-competitors ne crée PAS de concurrents — crée des candidates
- Seuls les candidats avec overlap > 65 déclenchent une notification
- Ne jamais re-alerter sur un candidat déjà vu (table competitor_candidates)
- Surgical : modifier send-alert uniquement pour ajouter la notification in-app
- Réutiliser la logique de création competitors/monitors existante
- Un commit par étape numérotée (sauf étape 0, pas de commit)
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@.claude/skills/crawlee-patterns/SKILL.md
@packages/ai/CLAUDE.md
@packages/db/CLAUDE.md
@packages/scrapers/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Générer une battle card produit un contenu structuré cohérent
✓ La battle card est éditable et les modifications persistent
✓ Le PDF se télécharge correctement et est stylé
✓ Un signal critical fait apparaître une notification dans la cloche en ~3s (SSE)
✓ Le compteur de non-lues fonctionne + "tout marquer comme lu"
✓ detect-new-competitors crée des candidates + notification "new_competitor"
✓ On ne re-alerte jamais sur un candidat déjà vu
✓ Ajouter un candidat le transforme en concurrent suivi avec monitors
✓ Ignorer un candidat le retire de la liste
✓ task_plan.md Phase 6 = complete
</verification>

<commit>
Commits dans l'ordre :
feat(db): add battle_cards, notifications, candidates tables
feat(ai): add battle card generation task
feat(workers): add battle card generation with PDF export
feat(api): add battle card endpoints with PDF download
feat(web): add battle card tab with edit and PDF export
feat(notifications): add in-app real-time alerts via SSE
feat(workers): add new competitor detection with candidates flow
</commit>