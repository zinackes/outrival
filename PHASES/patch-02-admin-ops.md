# Patch 02 — Dashboard ops (santé backend)

<context>
Dernière couche d'observabilité. C'est ta tour de contrôle : voir d'un coup
d'œil si le produit tourne et ne te ruine pas, débuguer un user, et lire les
feedbacks. Gaté à toi seul (l'opérateur du SaaS), PAS aux owners d'org.

Ce qui le rend possible : on a déjà signal_feed (ClickHouse), les feedbacks
(patch-05), monitors enrichis (patch-01 : requiresProxy, lastChangedAt). Il
manque deux tables de logs ops (scrape_runs, ai_runs) pour mesurer la santé
réelle du scraping et de l'IA.

Distinction CRITIQUE : "admin" ici = toi (opérateur), identifié par une
allowlist d'emails. Surtout PAS le role "owner" d'une org (ça donnerait l'accès
à tous les clients).

Lire avant : @CLAUDE.md, @docs/architecture.md, @.claude/skills/clickhouse/SKILL.md,
@.claude/skills/trigger-jobs/SKILL.md, @apps/api/CLAUDE.md, @apps/web/CLAUDE.md,
@packages/db/CLAUDE.md
</context>

<task>
Exécuter dans l'ordre. Committer après chaque étape.

## Étape 0 — Env

Pas de nouvelle dépendance. Ajouter dans `.env.local` :
```
ADMIN_EMAILS=ton@email.com      # allowlist, séparée par virgules
# OPS_SLACK_WEBHOOK_URL existe déjà (patch-05)
```

Commit : (pas de commit — passer à l'étape 1)

---

## Étape 1 — Tables ops ClickHouse

### packages/db/src/clickhouse-schema.ts
Ajouter à ensureClickhouseTables() (suivre @.claude/skills/clickhouse/SKILL.md) :

```typescript
await ch.command({ query: `
  CREATE TABLE IF NOT EXISTS scrape_runs (
    monitor_id String,
    competitor_id String,
    source_type String,
    status String,           -- success | no_change | failed
    used_proxy UInt8,        -- 0 | 1
    duration_ms UInt32,
    recorded_at DateTime DEFAULT now()
  ) ENGINE = MergeTree() ORDER BY (recorded_at)
`});

await ch.command({ query: `
  CREATE TABLE IF NOT EXISTS ai_runs (
    task String,             -- classify | insight | digest | analyze_product | score_overlap | battle_card
    provider String,         -- groq | claude
    model String,
    status String,           -- success | parse_failed | error
    recorded_at DateTime DEFAULT now()
  ) ENGINE = MergeTree() ORDER BY (recorded_at)
`});
```

pnpm ch:setup

→ vérifier : les 2 tables existent dans ClickHouse

Commit : `feat(db): add scrape_runs and ai_runs clickhouse tables`

---

## Étape 2 — Audit log (Postgres)

### packages/db/src/schema/audit-log.ts
Trace les actions admin (force scrape, consultation d'un user).
```typescript
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),       // view_user | force_scrape | update_feedback
  targetType: text("target_type"),         // user | monitor | feedback
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

Ajouter au schema/index.ts. pnpm db:push --filter @outrival/db

Commit : `feat(db): add audit log table`

---

## Étape 3 — Instrumenter le scraping (scrape_runs)

### Modifier apps/workers/src/jobs/scrape-monitor.job.ts
À la fin du job (succès, no_change, ET échec), insérer une ligne scrape_runs.
Mesurer la durée (timestamp début/fin). Surgical : ajouter uniquement le
logging ops, ne pas toucher à la logique existante.

```typescript
const startedAt = Date.now();
// ... logique de scrape existante ...
await ch.insert({
  table: "scrape_runs",
  values: [{
    monitor_id: monitor.id,
    competitor_id: monitor.competitorId,
    source_type: monitor.sourceType,
    status,                          // "success" | "no_change" | "failed"
    used_proxy: outcome?.usedProxy ? 1 : 0,
    duration_ms: Date.now() - startedAt,
    recorded_at: new Date(),
  }],
  format: "JSONEachRow",
});
```

Envelopper dans un try/catch pour que l'échec du logging ops ne casse jamais le scrape.

→ vérifier : un scrape → une ligne scrape_runs avec le bon status + used_proxy

Commit : `feat(workers): log scrape runs to clickhouse for ops`

---

## Étape 4 — Instrumenter l'IA (ai_runs)

Dans les jobs workers qui appellent les tâches IA (classify-change, generate-signal,
+ onboarding analyze/score s'ils passent par workers), logger le résultat dans ai_runs :
status = "success" si parsing OK, "parse_failed" si la tâche a retourné null,
"error" si exception.

Garder packages/ai PUR (pas d'accès DB) : c'est le JOB qui logge, pas la tâche.
La tâche retourne null en cas d'échec parsing (déjà le cas), le job en déduit le status.

```typescript
const classification = await classifyChange(diffText);
await logAiRun("classify", "groq", "llama-3.3-70b-versatile",
  classification ? "success" : "parse_failed");
```

Créer un petit helper logAiRun dans apps/workers/src/lib/ (insert ClickHouse,
try/catch silencieux).

→ vérifier : une classification → une ligne ai_runs ; forcer un parse fail → status parse_failed

Commit : `feat(workers): log ai runs to clickhouse for quality monitoring`

---

## Étape 5 — Middleware admin + routes API

### apps/api/src/middleware/admin.ts
```typescript
import { createMiddleware } from "hono/factory";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const adminMiddleware = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user || !adminEmails.includes(user.email.toLowerCase())) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});
```

### apps/api/src/routes/admin.ts
Toutes les routes : authMiddleware PUIS adminMiddleware.

```
GET /api/admin/overview
  → orgs par plan, total users, total concurrents suivis, signals (7j)

GET /api/admin/scraping-health        (ClickHouse scrape_runs, 24h)
  → par source : total runs, taux d'échec, taux de fallback proxy, durée moyenne
  → monitors "morts" : ceux dont les N derniers runs sont tous failed

GET /api/admin/ai-health              (ClickHouse ai_runs + signal_feed)
  → par task : taux de parse_failed, taux d'error
  → signals générés / jour (7 derniers jours)

GET /api/admin/cost                   (estimations dérivées)
  → scrapes proxy (24h/30j) × crédits estimés ≈ coût ScrapingBee
  → appels ai_runs (24h/30j) ≈ coût Groq estimé
  → taille Postgres + ClickHouse + R2 (approx)
  → afficher comme TENDANCES, marqué "estimations"

GET /api/admin/users?q=               → recherche user/org
GET /api/admin/users/:id              → détail : org, concurrents, monitors,
                                         dernier scrape de chacun
  → logger view_user dans audit_log

POST /api/admin/monitors/:id/force-scrape
  → trigger scrape-monitor { force: true }
  → logger force_scrape dans audit_log

GET /api/admin/feedback?status=       → liste des feedbacks (vue riche, patch-05)
PATCH /api/admin/feedback/:id         → changer status (new/reviewed/resolved)
  → logger update_feedback

GET /api/admin/audit-log              → dernières actions admin
```

→ vérifier : un email hors allowlist → 403 ; un email admin → accès OK

Commit : `feat(api): add owner-gated admin ops endpoints`

---

## Étape 6 — Job de santé ops + alertes Slack

### apps/workers/src/jobs/ops-health-check.job.ts
Tâche schedulée (ex: toutes les 6h). Calcule des seuils et ping OPS_SLACK_WEBHOOK_URL
si dépassement. CONSERVATEUR (anti alert-fatigue).

Alertes :
```
- Taux d'échec scraping > 30% sur 6h         → "⚠️ Scraping dégradé : X% d'échec"
- 0 signal généré sur 24h                     → "🚨 Pipeline IA muet depuis 24h"
- Taux de parse_failed IA > 25% sur 6h        → "⚠️ IA parsing dégradé : X%"
- Scrapes proxy/jour > seuil défini            → "💸 Coût proxy en hausse : X scrapes"
```

Utiliser sendSlackMessage (packages/shared, depuis patch-05).

→ vérifier : déclencher manuellement avec des conditions dégradées → alerte reçue

Commit : `feat(workers): add ops health check with slack alerts`

---

## Étape 7 — UI dashboard admin (/admin)

### apps/web/src/app/(admin)/admin/page.tsx
Route séparée, vérifiée côté serveur (email dans l'allowlist sinon 404/redirect).

Sections (cartes) :
```
1. Vue d'ensemble    → orgs par plan, users, concurrents, signals 7j
2. Santé scraping    → tableau par source (échec %, proxy %, durée),
                        liste des monitors morts
3. Santé IA          → taux parse_failed par task, courbe signals/jour
4. Coût (estimations) → proxy/jour, appels IA/jour, tailles DB — marqué "estimé"
5. Feedbacks         → liste (type, message, page, user), screenshot,
                        erreurs console, changement de statut
6. Debug utilisateur → recherche → détail org/concurrents/monitors,
                        bouton "forcer un scrape"
7. Audit log         → dernières actions admin
```

Graphiques recharts (signals/jour, échecs). Design Outrival (dark, amber,
Geist Mono pour les chiffres). Dense, fonctionnel — c'est un outil interne,
pas une vitrine.

→ vérifier : /admin accessible uniquement aux emails de l'allowlist
→ vérifier : toutes les sections affichent des données réelles
→ vérifier : "forcer un scrape" déclenche + log audit ; lire un feedback affiche le screenshot

Commit : `feat(web): add admin ops dashboard`

---

## Étape 8 — Vérification finale

```bash
pnpm build && pnpm typecheck && pnpm ch:setup
```

Test :
1. Email hors allowlist → /admin inaccessible (403/redirect)
2. Email admin → dashboard complet
3. Lancer quelques scrapes → santé scraping reflète les runs (échec %, proxy %)
4. Générer des signals → santé IA + signals/jour à jour
5. Coût : estimations cohérentes, marquées "estimé"
6. Feedbacks (patch-05) visibles avec screenshot + erreurs console
7. Forcer un scrape depuis le debug user → déclenché + ligne audit_log
8. Déclencher ops-health-check en conditions dégradées → alerte Slack

Mettre à jour findings.md :
- Seuils d'alerte ops configurés
- Estimations de coût (crédits ScrapingBee/req, tokens Groq moyens)
- Allowlist admin

task_plan.md : patch-02 → complete. Couche observabilité COMPLÈTE
(04 erreurs/logs + 03 analytics + 05 feedback + 02 admin ops).
</task>

<constraints>
- "admin" = allowlist d'emails (ADMIN_EMAILS), JAMAIS le role owner d'org
- Toutes les routes admin : authMiddleware PUIS adminMiddleware
- scrape_runs et ai_runs en ClickHouse (append-only, time-series)
- packages/ai reste PUR : c'est le job qui logge ai_runs, pas la tâche
- Le logging ops ne doit JAMAIS casser le scrape/l'IA (try/catch silencieux)
- Les coûts sont des ESTIMATIONS de tendance, clairement étiquetées (pas de la compta)
- Actions admin sensibles (view_user, force_scrape) → audit_log obligatoire
- Alertes ops conservatrices (anti alert-fatigue)
- Surgical : instrumenter scrape-monitor et les jobs IA sans réécrire leur logique
- Réutiliser sendSlackMessage (shared) et la table feedback (patch-05)
- Un commit par étape (sauf étape 0)
</constraints>

<references>
@CLAUDE.md
@docs/architecture.md
@.claude/skills/clickhouse/SKILL.md
@.claude/skills/trigger-jobs/SKILL.md
@apps/api/CLAUDE.md
@apps/web/CLAUDE.md
@packages/db/CLAUDE.md
</references>

<verification>
✓ pnpm build + typecheck → 0 erreurs
✓ scrape_runs et ai_runs créées en ClickHouse
✓ /admin gaté par l'allowlist d'emails (pas par role owner)
✓ Santé scraping : échec % + proxy % + monitors morts par source
✓ Santé IA : parse_failed % + signals/jour
✓ Coût : estimations de tendance étiquetées
✓ Feedbacks visibles avec screenshot + erreurs console + changement de statut
✓ Debug user fonctionnel + force scrape loggé en audit
✓ ops-health-check alerte sur Slack en conditions dégradées
✓ Le logging ops ne casse jamais le scrape/l'IA
✓ task_plan.md patch-02 = complete
</verification>

<commit>
feat(db): add scrape_runs and ai_runs clickhouse tables
feat(db): add audit log table
feat(workers): log scrape runs to clickhouse for ops
feat(workers): log ai runs to clickhouse for quality monitoring
feat(api): add owner-gated admin ops endpoints
feat(workers): add ops health check with slack alerts
feat(web): add admin ops dashboard
</commit>