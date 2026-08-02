# Architecture — Outrival

Index. Ce fichier est chargé à chaque session : il reste court **volontairement**.
Le détail vit dans `docs/architecture/*` et se lit **à la demande**.

| Tu travailles sur…                                   | Lis d'abord                        |
|------------------------------------------------------|------------------------------------|
| une table, une colonne, un enum, une migration        | `docs/architecture/schema.md`      |
| un scraper, un job, un signal, un diff, une extraction| `docs/architecture/pipeline.md`    |
| un flag, une clé API, une var d'env                   | `docs/architecture/env.md`         |
| « pourquoi c'est fait comme ça » avant de changer     | `docs/architecture/decisions.md`   |
| login, session, 2FA, passkeys, SSE                    | `docs/architecture/auth.md`        |

Docs spécialisées les plus consultées : `deployment.md` · `staged-extraction.md` ·
`platform-detection.md` · `tier-limits.md` · `pricing-coverage-2026.md` ·
`ask-outrival.md` · `visual-diff.md` · `docs-source.md` ·
`trigger-to-pgboss-migration.md` (historique).

**Règle d'entretien** : une nouvelle feature documente son détail dans le sous-doc
concerné, pas ici. Ce fichier ne bouge que si le domaine, la stack, l'infra, la
grille de plans ou la roadmap changent.

## Domaine métier

| Entité                | Description |
|-----------------------|-------------|
| Organization          | Workspace d'un utilisateur (plan, billing, productProfile, settings notifications) |
| User                  | Utilisateur d'une org (Better Auth gère sessions/accounts/verifications) |
| Competitor            | Entreprise externe surveillée + résumé IA |
| Monitor               | Config de surveillance d'une source (type, fréquence, requiresLevel, lastChangedAt, nextRunAt) |
| Snapshot              | État capturé d'une source à un instant T (HTML stocké sur R2) |
| Change                | Diff détecté entre deux snapshots (texte tronqué 50KB + rawDiff jsonb) |
| Signal                | Change classifié par IA avec insight stratégique et sévérité |
| Digest                | Rapport hebdomadaire IA agrégeant les signaux d'une org |
| Alert                 | Notification temps-réel envoyée par email/Slack/webhook |
| Notification          | Notification in-app temps-réel via SSE (DB-backed) |
| JobPosting            | Offre d'emploi structurée détectée chez un concurrent |
| Review                | Praise/complaint extraite de G2, Capterra, App Store |
| BattleCard            | Fiche stratégique IA exportable en PDF (sections jsonb editables) |
| CompetitorCandidate   | Concurrent suggéré à valider — détecté chaque semaine (Exa, `source=detection`) ou sauvé depuis la découverte d'onboarding non sélectionnée (`source=onboarding`) |
| TechStackEntry        | Technologie tierce détectée chez un concurrent (paiements, CRM, analytics…) via headers/scripts/DOM/footer — scraper mensuel indépendant (patch-18) |
| Product               | SKU de l'org (patch-28) — wrapper fin sur un self-competitor (`selfCompetitorId`, ancre de monitoring) ; multi-SKU = N self-competitors. isPrimary/status/position |
| ProductCompetitor     | Junction product↔competitor (patch-28) — competitors au niveau Org ; la LIGNE est l'appartenance (lié à N products = suivi pour N products). Pilote le tagging signals + les feeds par product |

## Stack

| Couche            | Technologie                              | Raison |
|-------------------|------------------------------------------|--------|
| Frontend          | **Next.js 16** App Router + React 19     | RSC + streaming, server components natifs |
| UI                | Tailwind v4 + shadcn/ui new-york         | Itération rapide, composants cohérents |
| API               | Hono sur Bun                             | 3-4× plus rapide que NestJS pour CRUD + triggers |
| Auth              | Better Auth v1.6                         | Self-hosted, flexible, bon DX |
| ORM               | Drizzle ORM                              | Type-safe, léger, Postgres |
| DB                | PostgreSQL (Neon)                        | Serverless, scale-to-zero, branching ; relationnel + time-series/analytics dans une seule base |
| Stockage binaire  | Cloudflare R2                            | Quasi-gratuit pour snapshots HTML/screenshots/PDFs |
| Jobs              | **pg-boss v12** self-hosted (`@outrival/queue`)     | Postgres-natif : 0 € de logiciel, pas de compteur par run, pas de cap à 10 crons, pas de risque roadmap vendeur. Trigger.dev est entièrement retiré depuis la Phase 7 (2026-08-02) : plus de wrappers, plus de schedules déclaratifs, pg-boss est le seul exécuteur. Historique : `docs/trigger-to-pgboss-migration.md` |
| Scraping          | Playwright (Chromium) + fetch            | Rendu honnête : UA OutrivalBot identifiable, pas de spoofing d'automatisation, respect robots.txt (collection doctrine) |
| Parsing YAML      | `yaml` (MIT, dép de @outrival/scrapers)  | Specs OpenAPI publiées en YAML (source `docs`) — un parser maison sur un sous-ensemble YAML casserait en silence sur les ancres / blocs multi-lignes |
| Egress proxy      | ProxyScrape datacenter (egress amont)    | Cascade 3 niveaux (L0 fetch · L1 render · L2 datacenter). Collection doctrine : arrêt sur refus, jamais d'escalade IP/fingerprint |
| Discovery         | Exa.ai (`exa-js`)                        | Recherche sémantique de concurrents similaires |
| Email             | Resend                                   | Alerts + digests transactionnels |
| Paiements         | Stripe (SDK v22)                         | Checkout + Customer Portal + webhooks |
| Insights IA       | Pool OpenAI-compat (`gpt-oss-120b`)      | Cerebras p1 → Cloudflare Workers AI p2 → Groq p3 → Mistral p4, tous gratuits. `tier:"fast"` → `gpt-oss-20b` (Groq + Cloudflare). Les llama-3.x sont arrêtés par Groq le 2026-08-16. `AI_CONFIG.model` est ignoré sur le chemin pool |
| Déploiement       | OVH VPS + Coolify                        | Self-hosted, EU GDPR, €8/mois |

> **Note** : Upstash Redis a été retiré du stack (Phase 6). Les alertes temps-réel
> passent par SSE DB-backed (poll Postgres 3s + heartbeat), latence ~3s suffisante
> pour de la veille. À ré-introduire uniquement si besoin de rate-limiting API.

## Infrastructure

```
OVH VPS (4 vCPU / 8GB RAM / 80GB SSD) — €8/mois
└── Coolify (PaaS self-hosted)
    ├── @outrival/web     → outrival.io        (:3000) Next.js 16
    ├── @outrival/api     → api.outrival.io    (:3001) Hono + Bun
    ├── @outrival/workers → pg-boss : 2 services, WORKER_ROLE=light (crons/IA/
    │   extracts/alerts, ~1 Go) et WORKER_ROLE=browser (scrapes/platform/PDF,
    │   4-5 Go, shm-size 1g). Le light possède seul cron + maintenance.
    └── queue-postgres    → Postgres dédié always-on (~512 Mo) — schéma `pgboss`
        UNIQUEMENT (QUEUE_DATABASE_URL). JAMAIS Neon : un poller sub-2s défait le
        scale-to-zero et facture des compute-hours. Créé par boss.start().

Neon (EU) — €0 free tier → ~$19/mois (Launch) à l'échelle
└── PostgreSQL — relationnel + time-series/analytics (ex-ClickHouse) dans une
    seule base. Connexion via le pooler (`-pooler`, ?sslmode=require). La queue
    pg-boss (QUEUE_DATABASE_URL) utilise un Postgres dédié always-on distinct,
    jamais cette branche Neon.

Cloudflare R2 — ~€1/mois
└── Snapshots HTML, screenshots, PDFs battle cards

Heartbeat externe (Better Stack / UptimeRobot) — €0
└── Le worker light ping HEARTBEAT_URL toutes les 5 min ; le monitor alerte quand
    les pings S'ARRÊTENT. Seule alerte qui survit à la mort du VPS ou de la queue.

ProxyScrape — datacenter ~$10/mois (flat, BW illimitée, egress amont — collection doctrine)
Resend — $20/mois Pro (50k emails/mois)
Stripe — % par transaction
Exa.ai — pay-per-search (discovery hebdomadaire)
Groq — $0.59/M tokens input, $0.79/M tokens output (llama-3.3-70b)
```

**Total estimé à l'échelle (~50 orgs actives)** : €120-180/mois infra + variable IA/scraping.

## Plans & gating

Source unique : `packages/shared/src/constants/plans.ts` — `PLAN_LIMITS` lu par
API gating, web UI, paywalls, et workers (send-alert).

| Plan      | Max concurrents | Sources                                                | Fréquence min | Channels                | Features |
|-----------|-----------------|--------------------------------------------------------|---------------|-------------------------|----------|
| free      | 2               | homepage, pricing, blog                                | weekly        | email                   | —        |
| starter   | 5               | + jobs                                                 | daily         | + slack                 | —        |
| pro       | 15              | + g2_reviews, capterra_reviews, docs                   | realtime      | + webhook               | battleCards, realtimeAlerts |
| business  | ∞               | + appstore_reviews                                     | realtime      | email + slack + webhook | + api, multiUser |

Codes d'erreur structurés sur les routes gating : `plan_limit_competitors`,
`plan_locked_feature`, `plan_locked_source`, `plan_locked_frequency`,
`plan_locked_channel`. Le web parse via `paywallFromError(err)` et affiche
`<PaywallDialog>`.

**Plafond horaire d'actions IA** (`PLAN_LIMITS.aiActionsPerHour` 20/40/120/300,
compteur Redis `ratelimit:ai_intensive:<userId>`, 429 `ai_rate_limit_exceeded`) : le
garde-fou anti-abus au-dessus des caps ci-dessus. Il était **plat à 10/h pour tous les
tiers** de patch-22 au 2026-07-31, donc free et business partageaient un plafond que 11
clics de n'importe quelle nature suffisaient à atteindre, et les caps qu'il surplombe
(pro : 20 re-scans + 50 battle cards par jour) étaient inatteignables en rafale. Trois
propriétés le cadrent : il compte des **CLICS, pas des appels pool** (une battle card =
1 tick pour ~5 appels, un re-scan sur page inchangée = 1 tick pour 0), donc il ne peut
être qu'un plafond grossier ; la **première activation d'une source en est exemptée**
(`consumeAiAction` appelé DANS `/monitors/:id/run` et `/:id/force-rescan`, seulement si
`lastRunAt !== null`, exactement comme l'exemption existante du cap forced-rescan) parce
qu'activer toutes les sources d'un roster pro fait `maxCompetitors × allowedSources` =
135 clics ; et `AI_INTENSIVE_RATE_LIMIT` ne survit que comme **override d'urgence** qui
ré-aplatit tous les tiers sur une valeur. Affiché dans Settings → Usage (ligne « AI
actions · this hour »), sans quoi c'est le seul cap que l'utilisateur découvre en se le
prenant. 📄 docs/tier-limits.md

## Roadmap (post-MVP)

- Phase 8 : Diffs visuels (screenshot before/after + heatmap)
- Phase 9 : LinkedIn + Twitter scrapers (volumétrie : SSE → WebSocket dédié)
- Phase 10 : Multi-user orgs (RBAC, invitations) — feature `multiUser` business
- Phase 11 : API publique — feature `api` business
- Phase 12 : Auto-discovery URL G2/Capterra (heuristique nom + slug)
