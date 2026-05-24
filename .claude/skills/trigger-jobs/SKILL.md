---
name: trigger-jobs
description: >
  Utiliser quand on crée ou modifie un job Trigger.dev v3.
  Contient les patterns complets avec idempotence, concurrence,
  et les jobs spécifiques à Outrival.
allowed-tools: [Read, Write, Edit]
---

# Trigger.dev v3 Patterns — Outrival

## Structure de base

```typescript
// apps/workers/src/jobs/[name].job.ts
import { task, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const InputSchema = z.object({
  monitorId: z.string().uuid(),
  competitorId: z.string().uuid(),
});

export const scrapeSourceJob = task({
  id: "scrape-source",
  maxAttempts: 3,
  machine: { preset: "small-1x" },

  async run(payload: z.infer, { ctx }) {
    const input = InputSchema.parse(payload);
    ctx.log("Starting scrape-source", { monitorId: input.monitorId });

    // Idempotence check
    const recentSnapshot = await db.query.snapshots.findFirst({
      where: and(
        eq(snapshots.monitorId, input.monitorId),
        gte(snapshots.scrapedAt, subHours(new Date(), 1))
      ),
    });
    if (recentSnapshot) {
      ctx.log("Snapshot recent, skipping", { snapshotId: recentSnapshot.id });
      return { skipped: true };
    }

    // ... logique principale

    ctx.log("Completed scrape-source", { monitorId: input.monitorId });
    return { ok: true };
  },
});
```

## Concurrence par domaine

```typescript
export const scrapeSourceJob = task({
  id: "scrape-source",
  concurrencyKey: async (payload) => {
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, payload.monitorId),
      with: { competitor: true },
    });
    return new URL(monitor!.competitor.url).hostname;
  },
  queue: { concurrencyLimit: 1 },
  // ...
});
```

## Jobs clés Outrival

### scrape-monitor.job.ts
Scrape une source pour un monitor. Inputs : monitorId.
Logique : scrape → upload R2 → compute diff → create Change si changé → trigger classify-change.

### classify-change.job.ts
Classifie un Change avec Groq. Inputs : changeId.
Logique : lire change → Groq classification → si significant → trigger generate-signal.

### generate-signal.job.ts
Génère un Signal avec Claude Sonnet. Inputs : changeId, classification.
Logique : lire change + context competitor → Claude insight → stocker Signal → si severity high/critical → trigger send-alert.

### generate-weekly-digest.job.ts
Génère le digest hebdomadaire. Inputs : orgId, weekStart.
Idempotence : vérifier si digest existe déjà pour cette semaine.
Logique : agréger signals de la semaine → Claude Sonnet digest → stocker → Resend email.

### discover-competitors.job.ts
Découverte auto des concurrents. Inputs : orgId, productUrl.
Logique : Exa.ai search → score overlap → retourner liste triée.

## AbortTaskRunError (erreurs non-retriable)

```typescript
// Utiliser pour les erreurs qui ne bénéficieront pas d'un retry
if (!monitor) {
  throw new AbortTaskRunError(`Monitor ${input.monitorId} not found`);
}
```