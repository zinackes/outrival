# Patch 04 — Erreurs, logs & uptime

<context>
Première couche d'observabilité, à faire avant la beta. Objectif : ne jamais
lancer à l'aveugle. Trois choses :

1. Sentry sur web/api/workers — capture les erreurs techniques que les
   utilisateurs ne signalent pas (crashes, exceptions silencieuses).
2. pino — logging structuré avec redaction des secrets/PII sur tous les services.
3. Health checks profonds + uptime monitoring externe — savoir si un service
   tombe avant que les users s'en plaignent.

Décisions cross-cutting appliquées partout :
- Séparation environnements : Sentry n'envoie qu'en production
- Sampling : rester dans les free tiers (traces à 10%)
- PII : jamais de tokens/emails/clés en clair dans les logs ni Sentry
- Session replay DÉSACTIVÉ côté Sentry (on utilise PostHog pour ça → patch-03)
- Source maps uploadées pour des stack traces lisibles

Lire avant : @CLAUDE.md, @docs/architecture.md, @apps/api/CLAUDE.md,
@apps/workers/CLAUDE.md, @apps/web/CLAUDE.md, @.claude/skills/trigger-jobs/SKILL.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Dépendances + env

```bash
# Logging partagé
pnpm add pino --filter @outrival/shared
pnpm add -D pino-pretty --filter @outrival/shared

# Sentry backend (compatible Bun)
pnpm add @sentry/node --filter @outrival/api
pnpm add @sentry/node --filter @outrival/workers

# Sentry frontend (via wizard à l'étape 4)
```

Ajouter dans `.env.local` (et préparer pour la prod) :
```
LOG_LEVEL=info
SENTRY_DSN_API=
SENTRY_DSN_WORKERS=
SENTRY_DSN_WEB=
SENTRY_AUTH_TOKEN=          # pour l'upload des source maps (build-time)
# Optionnel (log shipping différé) :
AXIOM_TOKEN=
AXIOM_DATASET=outrival
```

Créer un projet Sentry (org → 3 projets : outrival-web, outrival-api,
outrival-workers) pour une triage propre par service. Récupérer les 3 DSN.

→ vérifier : pnpm install passe sans erreur

Commit : `chore(deps): install sentry and pino`

---

## Étape 1 — Logger partagé (packages/shared)

### packages/shared/src/logger.ts
```typescript
import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Ne JAMAIS logger de secrets ni de PII en clair
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.secret",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.email",
      "*.stripeCustomerId",
      "DATABASE_URL",
    ],
    censor: "[REDACTED]",
  },
  ...(isDev && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});

// Helper pour créer un logger enfant avec contexte
export function childLogger(context: Record) {
  return logger.child(context);
}
```

Réexporter depuis packages/shared/src/index.ts.

Remplacer progressivement les console.log/console.error existants par logger
(api + workers). Surgical : ne pas tout réécrire d'un coup, viser les points
critiques (erreurs, jobs, pipeline IA).

→ vérifier : pnpm typecheck --filter @outrival/shared
→ vérifier : un log en dev s'affiche joliment, un objet avec token est redacté

Commit : `feat(shared): add structured logger with PII redaction`

---

## Étape 2 — Sentry sur l'API (apps/api)

### apps/api/src/lib/sentry.ts
```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN_API,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.1,        // 10% — rester dans le free tier
  sendDefaultPii: false,        // pas de PII automatique
});

export { Sentry };
```

Importer ce fichier en TOUT PREMIER dans apps/api/src/index.ts
(avant tout autre import, pour que l'instrumentation soit active).

### Brancher dans le error handler Hono
```typescript
import { Sentry } from "./lib/sentry";
import { logger } from "@outrival/shared";

app.onError((err, c) => {
  Sentry.captureException(err);
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});
```

→ vérifier : déclencher une erreur volontaire en prod-like (NODE_ENV=production)
   → elle apparaît dans Sentry outrival-api

Commit : `feat(api): add sentry error tracking`

---

## Étape 3 — Sentry sur les workers (apps/workers)

### apps/workers/src/lib/sentry.ts
Même init que l'API mais avec SENTRY_DSN_WORKERS.

### Capturer les erreurs de jobs
Trigger.dev v3 a un hook d'erreur. Dans trigger.config.ts, ajouter un
handler global qui capture vers Sentry (suivre @.claude/skills/trigger-jobs/SKILL.md
et la doc Trigger.dev pour la lifecycle hook `handleError` / `onFailure`).
Ajouter aussi l'upload des source maps pour des stack traces lisibles.

Intent : toute exception non gérée dans un job → capturée dans Sentry
outrival-workers avec le contexte (job id, payload non sensible).

→ vérifier : un job qui throw en prod-like → erreur visible dans Sentry workers

Commit : `feat(workers): add sentry error tracking for jobs`

---

## Étape 4 — Sentry sur le frontend (apps/web)

Utiliser le wizard officiel :
```bash
cd apps/web && pnpm dlx @sentry/wizard@latest -i nextjs
```

Puis ajuster la config générée :
- `environment` = NODE_ENV, `enabled` uniquement en production
- `tracesSampleRate: 0.1`
- **DÉSACTIVER le Session Replay de Sentry** (`replaysSessionSampleRate: 0`,
  `replaysOnErrorSampleRate: 0`) — on utilise PostHog pour ça (patch-03),
  inutile de payer deux fois
- Vérifier que l'upload des source maps utilise SENTRY_AUTH_TOKEN
- DSN = SENTRY_DSN_WEB

→ vérifier : une erreur client en prod-like remonte dans Sentry outrival-web
   avec une stack trace lisible (source maps OK)

Commit : `feat(web): add sentry with source maps, replay disabled`

---

## Étape 5 — Health checks profonds (apps/api)

### apps/api/src/routes/health.ts
Étendre le health check existant (Phase 1) :
```typescript
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
// importer les clients ClickHouse + Redis selon ce qui est branché

export const healthRouter = new Hono();

// Liveness : le process répond
healthRouter.get("/live", (c) => c.json({ status: "ok" }));

// Readiness : les dépendances sont joignables
healthRouter.get("/ready", async (c) => {
  const checks: Record = { db: false, clickhouse: false, redis: false };

  try { await db.execute(sql`SELECT 1`); checks.db = true; } catch {}
  try { /* await ch.ping() */ checks.clickhouse = true; } catch {}
  try { /* await redis.ping() */ checks.redis = true; } catch {}

  const ok = Object.values(checks).every(Boolean);
  return c.json({ status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});
```

(Adapter les pings ClickHouse/Redis aux clients réellement branchés.)

→ vérifier : /health/live → 200
→ vérifier : /health/ready → 200 si tout up, 503 + détail si une dépendance tombe

Commit : `feat(api): add deep liveness and readiness health checks`

---

## Étape 6 — Uptime monitoring + alertes (config)

Surtout de la config externe, peu de code.

**Uptime externe (Better Stack ou UptimeRobot, free tier) :**
- Monitor sur https://api.outrival.io/health/live — ping chaque minute
- Monitor sur https://outrival.io (la web app)
- Alerte → email + Slack si down

**Alertes erreurs (Sentry → Slack) :**
- Connecter l'intégration Slack dans Sentry
- Règle d'alerte : nouvelle issue OU pic d'erreurs → notif Slack
- Garder ça CONSERVATEUR (anti alert-fatigue) : alerter sur les erreurs
  nouvelles/critiques, pas sur chaque occurrence

Documenter ces réglages dans findings.md (URLs des monitors, règles configurées).

Commit : `docs: document uptime and alerting configuration`

---

## Étape 7 — Log shipping (OPTIONNEL — différable)

Au lancement, les logs Coolify (VPS) + Trigger.dev couvrent l'essentiel.
Quand le volume le justifie, brancher pino vers Axiom :

```bash
pnpm add @axiomhq/pino --filter @outrival/shared
```
Ajouter un transport pino conditionnel (si AXIOM_TOKEN présent) vers Axiom.
NE PAS bloquer le lancement là-dessus — étape à activer plus tard.

(Pas de commit obligatoire — à faire au moment voulu.)

---

## Étape 8 — Vérification finale

```bash
pnpm build && pnpm typecheck
```

Test (avec NODE_ENV=production en local pour activer Sentry) :
1. Erreur volontaire dans l'API → visible dans Sentry outrival-api
2. Job qui throw → visible dans Sentry outrival-workers
3. Erreur client → visible dans Sentry outrival-web avec source maps
4. /health/live → 200 ; /health/ready → reflète l'état des dépendances
5. Logger : un objet contenant un token est bien redacté
6. Couper une dépendance (ex: DB) → /health/ready passe en 503

Mettre à jour findings.md :
- DSN/projets Sentry configurés
- Réglages de sampling
- URLs des monitors uptime + règles d'alerte Slack
- Points où le logger a remplacé les console.*

task_plan.md : patch-04 → complete. Prochain : patch-03 (PostHog).
</task>

<constraints>
- Sentry ENABLED uniquement en production (jamais en dev)
- tracesSampleRate à 0.1 (rester dans le free tier) — ajustable selon le volume
- Session replay Sentry DÉSACTIVÉ (PostHog s'en charge en patch-03)
- Aucun secret/PII en clair dans les logs (config redact de pino)
- sendDefaultPii: false sur tous les Sentry
- Surgical : remplacer les console.* aux points critiques, pas tout d'un coup
- Health checks : /live ne touche aucune dépendance, /ready les teste toutes
- Alertes Slack conservatrices (anti alert-fatigue)
- Le log shipping (étape 7) est optionnel et ne bloque pas le lancement
- Un commit par étape (sauf 7)
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@apps/api/CLAUDE.md
@apps/workers/CLAUDE.md
@apps/web/CLAUDE.md
@.claude/skills/trigger-jobs/SKILL.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ Erreur API → Sentry outrival-api (prod uniquement)
✓ Erreur job → Sentry outrival-workers
✓ Erreur client → Sentry outrival-web avec stack trace lisible (source maps)
✓ Sentry désactivé en dev
✓ Session replay Sentry désactivé
✓ /health/live → 200 ; /health/ready → 200/503 selon les dépendances
✓ Logger redacte bien tokens/emails/secrets
✓ Uptime monitoring externe configuré + alerte Slack
✓ task_plan.md patch-04 = complete
</verification>

<commit>
chore(deps): install sentry and pino
feat(shared): add structured logger with PII redaction
feat(api): add sentry error tracking
feat(workers): add sentry error tracking for jobs
feat(web): add sentry with source maps, replay disabled
feat(api): add deep liveness and readiness health checks
docs: document uptime and alerting configuration
</commit>