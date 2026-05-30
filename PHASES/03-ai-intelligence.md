# Phase 3 — Intelligence IA

<context>
Les Phases 1 et 2 sont terminées : monorepo, auth, scraping fonctionnel
(homepage/pricing/blog), détection de changements stockés en DB,
activity feed dans le dashboard.

Cette phase rend le produit intelligent et autonome :
- Chaque changement détecté est classifié puis transformé en insight stratégique
- Les changements importants déclenchent des alertes (Slack + email)
- Un digest hebdomadaire IA est généré et envoyé par email
- Le scraping devient automatique (cron selon la fréquence des monitors)

Tout le pipeline IA passe par Groq pour l'instant (gratuit, rapide),
avec une abstraction provider permettant de swapper vers Claude plus tard.

Lire impérativement avant de commencer :
- @CLAUDE.md
- @docs/architecture.md
- @task_plan.md
- @findings.md
- @.claude/skills/ai-pipeline/SKILL.md
- @.claude/skills/trigger-jobs/SKILL.md
- @.claude/rules/jobs.md
- @packages/ai/CLAUDE.md
</context>

<goal>
À la fin de cette phase :
- packages/ai implémente le pipeline complet (config, provider, classify, insight, digest)
- Un changement détecté est automatiquement classifié et transformé en Signal
- Les Signals high/critical déclenchent une alerte Slack et/ou email
- Le scraping s'exécute automatiquement selon la fréquence de chaque monitor
- Un digest hebdomadaire est généré et envoyé par email (Resend)
- Le dashboard affiche les Signals avec insight + so_what
- Une page Digests affiche les digests passés
- pnpm build et pnpm typecheck passent à 0 erreur
</goal>

<task>
Exécuter dans cet ordre exact. Committer après chaque étape numérotée.

## Étape 0 — Dépendances

```bash
# packages/ai
pnpm add groq-sdk @anthropic-ai/sdk zod --filter @outrival/ai
pnpm add @outrival/shared --filter @outrival/ai

# apps/workers (pipeline IA + emails)
pnpm add @outrival/ai resend --filter @outrival/workers
```

Ajouter dans `.env.local` :
```
GROQ_API_KEY=...
ANTHROPIC_API_KEY=...        # optionnel pour l'instant (swap futur)
RESEND_API_KEY=...
```

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install phase 3 AI dependencies`

---

## Étape 1 — packages/ai (pipeline complet)

Implémenter exactement selon @.claude/skills/ai-pipeline/SKILL.md :

- packages/ai/src/config.ts        → AI_CONFIG (Groq-first)
- packages/ai/src/provider.ts      → complete() abstrait Groq/Claude
- packages/ai/src/lib/parse.ts     → safeParseJson avec Zod
- packages/ai/src/tasks/classify.ts → classifyChange()
- packages/ai/src/tasks/insight.ts  → generateInsight()
- packages/ai/src/tasks/digest.ts   → generateDigest()
- packages/ai/src/index.ts          → réexports

### packages/ai/src/env.ts
Validation Zod :
```typescript
import { z } from "zod";
const EnvSchema = z.object({
  GROQ_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
});
export const aiEnv = EnvSchema.parse(process.env);
```

### packages/ai/src/tasks/digest.ts
```typescript
import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

const DigestSchema = z.object({
  temperature: z.enum(["calme", "modérée", "agitée"]),
  tldr: z.array(z.string()).max(3),
  sections: z.array(z.object({
    urgency: z.enum(["action_required", "watch", "fyi"]),
    competitor: z.string(),
    category: z.string(),
    insight: z.string(),
    so_what: z.string(),
  })),
});

export type Digest = z.infer;

export async function generateDigest(
  signals: Array
): Promise {
  const prompt = `
${JSON.stringify(signals, null, 2)}



Génère un digest hebdomadaire de veille concurrentielle à partir de ces signaux.
- Évalue la température globale (calme/modérée/agitée)
- TL;DR : 3 points clés maximum
- Groupe les signaux : critical/high → action_required, medium → watch, low → fyi
Réponds UNIQUEMENT en JSON valide, sans markdown.


Format :
{
  "temperature": "calme|modérée|agitée",
  "tldr": ["point 1", "point 2", "point 3"],
  "sections": [
    { "urgency": "action_required|watch|fyi", "competitor": "...",
      "category": "...", "insight": "...", "so_what": "..." }
  ]
}`;

  const raw = await complete(AI_CONFIG.digest, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, DigestSchema);
  if (!result.ok) {
    console.error("Digest parse failed:", result.error);
    return null;
  }
  return result.value;
}
```

→ vérifier : pnpm typecheck --filter @outrival/ai
→ vérifier : test unitaire de classifyChange avec un diff mocké

Commit : `feat(ai): implement groq-first pipeline (classify, insight, digest)`

---

## Étape 2 — Schéma : config de notifications

Ajouter des colonnes à la table organizations (migration surgicale).

### packages/db/src/schema/organizations.ts
Ajouter :
```typescript
slackWebhookUrl: text("slack_webhook_url"),
digestEmail: text("digest_email"),
digestEnabled: boolean("digest_enabled").notNull().default(true),
alertsEnabled: boolean("alerts_enabled").notNull().default(true),
```

Puis : pnpm db:push --filter @outrival/db

→ vérifier : colonnes ajoutées dans Drizzle Studio

Commit : `feat(db): add notification settings to organizations`

---

## Étape 3 — Jobs classify + generate-signal

### apps/workers/src/jobs/classify-change.job.ts
Input : { changeId }
```
1. Récupérer le change + monitor + competitor
2. Si pas de diffText → AbortTaskRunError
3. classifyChange(change.diffText)
4. Si classification null → log + abort propre
5. Si is_significant = false → log "non significatif", retourner { significant: false }
6. Si is_significant = true → triggerAndWait generate-signal.job
   avec { changeId, classification }
```

### apps/workers/src/jobs/generate-signal.job.ts
Input : { changeId, classification }
```
1. Récupérer le change + competitor + orgId
2. generateInsight(diffText, competitor.name, competitor.category, classification)
3. Si insight null → AbortTaskRunError
4. Insérer un Signal en DB (severity, category depuis classification ;
   insight, soWhat, recommendedAction depuis insight)
5. Insérer une ligne dans ClickHouse signal_feed (org_id, competitor_id,
   category, severity, recorded_at)
6. Si severity IN (high, critical) ET org.alertsEnabled :
   → trigger send-alert.job avec { signalId }
7. context.log du résultat
```

Idempotence : vérifier qu'aucun Signal n'existe déjà pour ce changeId.

→ vérifier : déclencher classify-change avec un changeId réel → un Signal apparaît en DB

Commit : `feat(workers): add classify-change and generate-signal jobs`

---

## Étape 4 — Brancher le scraping sur le pipeline

### Modifier apps/workers/src/jobs/scrape-monitor.job.ts
À la fin, quand un Change est créé :
→ trigger classify-change.job avec { changeId }

Surgical : ne modifier QUE la partie qui crée le Change. Ne pas toucher
au reste de la logique de scraping.

→ vérifier : scraper un site modifié → Change créé → Signal généré automatiquement

Commit : `feat(workers): trigger AI pipeline after change detection`

---

## Étape 5 — Alertes (Slack + email)

### apps/workers/src/lib/resend.ts
```typescript
import { Resend } from "resend";
export const resend = new Resend(process.env.RESEND_API_KEY);
```

### apps/workers/src/lib/slack.ts
```typescript
export async function sendSlackMessage(webhookUrl: string, text: string): Promise {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
```

### apps/workers/src/jobs/send-alert.job.ts
Input : { signalId }
```
1. Récupérer le signal + competitor + org
2. Construire le message d'alerte :
   "🔴 [Competitor] — [category]\n[insight]\n→ [so_what]"
3. Si org.slackWebhookUrl → sendSlackMessage
4. Si org.digestEmail → envoyer email Resend (template simple)
5. Insérer une ligne dans la table alerts (channel, sentAt)
6. context.log
```

→ vérifier : générer un signal critical → alerte reçue (Slack test webhook ou email)

Commit : `feat(workers): add real-time alerts via slack and email`

---

## Étape 6 — Scraping automatique (cron)

### apps/workers/src/jobs/schedule-scraping.job.ts
Tâche schedulée Trigger.dev (cron) qui enqueue les monitors à scraper.
```typescript
import { schedules } from "@trigger.dev/sdk/v3";

export const scheduleScrapingJob = schedules.task({
  id: "schedule-scraping",
  cron: "0 * * * *", // toutes les heures
  async run(_payload, { ctx }) {
    // 1. Récupérer tous les monitors actifs dont nextRunAt <= now
    //    (ou null), filtrés par fréquence
    // 2. Pour chaque monitor → trigger scrape-monitor.job { monitorId }
    // 3. Mettre à jour nextRunAt selon la fréquence
    //    (realtime: +1h, daily: +24h, weekly: +7j)
    // 4. context.log du nombre de monitors enqueued
  },
});
```

Logique de fréquence :
- realtime → re-scrape toutes les heures
- daily → si lastRunAt > 24h
- weekly → si lastRunAt > 7j

→ vérifier : le cron apparaît dans le dashboard Trigger.dev
→ vérifier : déclencher manuellement → les monitors dûs sont enqueued

Commit : `feat(workers): add scheduled autonomous scraping via cron`

---

## Étape 7 — Digest hebdomadaire

### apps/workers/src/jobs/generate-weekly-digest.job.ts
Tâche schedulée (cron lundi matin) + déclenchable manuellement.
```
1. Pour chaque org avec digestEnabled :
2. Récupérer les signals de la semaine écoulée (7 derniers jours)
3. Si 0 signal → skip cette org (pas de digest vide)
4. generateDigest(signals)
5. Si digest null → log + skip
6. Insérer le digest en DB (content_json, temperature, weekStart, weekEnd)
7. Construire l'email HTML depuis le digest (template structuré
   🔴 action / 🟡 watch / 🟢 fyi)
8. Envoyer via Resend à org.digestEmail
9. Update digest.sentAt
```

Idempotence : un seul digest par org par semaine (vérifier weekStart).

Cron : `0 8 * * 1` (lundi 8h).

### apps/workers/src/lib/digest-email.ts
Fonction qui transforme un Digest en HTML email propre.
Design : dark, amber accents, sections par urgence.

→ vérifier : déclencher manuellement pour une org avec des signals → email reçu

Commit : `feat(workers): add weekly digest generation and email delivery`

---

## Étape 8 — Routes API (signals + digests)

### apps/api/src/routes/signals.ts
```
GET /api/signals
  query: ?limit=50&competitorId=&severity=&unreadOnly=
  → signals de l'org, join competitor, ordonné par createdAt desc

PATCH /api/signals/:id/read
  → marquer comme lu (isRead = true)
```

### apps/api/src/routes/digests.ts
```
GET /api/digests
  → liste des digests de l'org, ordonné par weekStart desc

GET /api/digests/:id
  → détail d'un digest (content_json)
```

### apps/api/src/routes/settings.ts
```
GET  /api/settings/notifications
PATCH /api/settings/notifications
  body: { slackWebhookUrl?, digestEmail?, digestEnabled?, alertsEnabled? }
```

Enregistrer les routers dans index.ts.

→ vérifier : GET /api/signals retourne les signals générés

Commit : `feat(api): add signals, digests, notification settings routes`

---

## Étape 9 — UI (signals + digests + settings)

### apps/web — Activity feed enrichi
Modifier le feed pour afficher les Signals (pas juste les Changes bruts) :
- Badge sévérité coloré (low/medium/high/critical)
- Insight + so_what visibles
- Badge catégorie
- Bouton "marquer comme lu"

### apps/web/src/app/(dashboard)/digests/page.tsx
- Liste des digests passés (semaine, température)
- Clic → détail du digest avec les sections par urgence

### apps/web/src/app/(dashboard)/settings/page.tsx
- Form config notifications :
  - Slack webhook URL
  - Email pour le digest
  - Toggle digest activé
  - Toggle alertes activées
- PATCH /api/settings/notifications

Respecter le design system Outrival (dark, amber, Syne + Inter, shadcn new-york).

→ vérifier : les signals s'affichent avec insight + so_what
→ vérifier : la page settings sauvegarde la config

Commit : `feat(web): display signals, digests, and notification settings`

---

## Étape 10 — Vérification finale

```bash
pnpm build      # 0 erreurs
pnpm typecheck  # 0 erreurs
pnpm dev
pnpm trigger:dev
```

Test end-to-end complet :
1. Ajouter un concurrent
2. Scraper manuellement → si changement, un Signal est généré avec insight
3. Le Signal apparaît dans le feed avec sa sévérité + so_what
4. Configurer un webhook Slack de test dans settings
5. Générer un signal critical → alerte Slack reçue
6. Déclencher manuellement generate-weekly-digest → email digest reçu
7. Le digest apparaît dans la page Digests
8. Vérifier que schedule-scraping enqueue bien les monitors dûs

---

## Étape 11 — Mettre à jour le planning

task_plan.md :
- Phase 3 Intelligence IA → complete ✓
- Phase 4 Competitor Discovery → in_progress (prochaine)

findings.md :
- Comportement Groq (qualité classification, format JSON, taux d'échec parsing)
- Réglages cron Trigger.dev
- Particularités Resend / Slack webhooks

progress.md : log de session.
</task>

<constraints>
- Tout le pipeline IA passe par Groq via AI_CONFIG — ne PAS hardcoder de provider
- Ne jamais générer d'insight sur un change non-significatif (classification d'abord)
- Ne pas implémenter la competitor discovery (Phase 4)
- Ne pas implémenter jobs/reviews scraping (Phase 5)
- Ne pas implémenter Stripe / billing (Phase 7)
- Les alertes/digests ne s'envoient QUE si la config org le permet
- Pas de digest vide — skip les orgs sans signal sur la semaine
- Surgical : modifier scrape-monitor uniquement à l'endroit du trigger pipeline
- Toujours valider les sorties IA avec Zod (safeParseJson)
- Un commit par étape numérotée
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/ai-pipeline/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@.claude/skills/clickhouse/SKILL.md
@.claude/rules/jobs.md
@packages/ai/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
La phase est terminée quand TOUS ces checks passent :

✓ pnpm build → 0 erreurs
✓ pnpm typecheck → 0 erreurs
✓ Un changement détecté génère automatiquement un Signal avec insight + so_what
✓ Un change non-significatif ne génère PAS de Signal
✓ Un Signal high/critical déclenche une alerte (Slack et/ou email)
✓ Le cron schedule-scraping enqueue les monitors dûs selon leur fréquence
✓ generate-weekly-digest produit un digest et envoie l'email
✓ Le feed affiche les Signals avec sévérité, catégorie, insight, so_what
✓ La page Digests affiche les digests passés
✓ La page Settings sauvegarde la config de notifications
✓ Une ligne est insérée dans ClickHouse signal_feed par signal
✓ task_plan.md Phase 3 = complete
</verification>

<commit>
Commits dans l'ordre :
chore(deps): install phase 3 AI dependencies
feat(ai): implement groq-first pipeline (classify, insight, digest)
feat(db): add notification settings to organizations
feat(workers): add classify-change and generate-signal jobs
feat(workers): trigger AI pipeline after change detection
feat(workers): add real-time alerts via slack and email
feat(workers): add scheduled autonomous scraping via cron
feat(workers): add weekly digest generation and email delivery
feat(api): add signals, digests, notification settings routes
feat(web): display signals, digests, and notification settings
</commit>