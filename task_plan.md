# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [x] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [x] Phase 3 — Intelligence IA (Groq classify+insight+digest, alertes, cron)
- [x] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [x] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [x] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel SSE)
- [x] Phase 7 — Monétisation (Stripe, free tier limits, gating, paywalls)

## Phase en cours
Phases core terminées. Patch-04 (observabilité Sentry + pino + health checks)
appliqué le 2026-05-27. Reste landing page + polish global via Claude Design
(hors phases Claude Code).

## Patches appliqués

- [x] patch-01 — Scraping cost optimization (direct-first + adaptive reschedule)
- [x] patch-04 — Errors, logs & uptime (Sentry + pino + health checks profonds)
- [x] patch-03 — PostHog analytics + session replay (terminé 2026-05-27)
- [x] patch-05 — Widget feedback (terminé 2026-05-27)
- [~] patch-07 — Perf scraping (PARTIEL, 2026-05-31) : gzip R2 + conditional fetch
      (blog/changelog) faits. Étapes 2/4/5 (browser pool, undici, domain throttle)
      SKIP — no-op sur runtime Trigger.dev à machine isolée/run. Détails + à-revisiter
      dans findings.md § "Patch 07".
- [x] patch-08 — Onboarding par stade de projet (implémenté 2026-05-31 — complete)
- [x] patch-09 — Optimisation coût IA (implémenté 2026-06-01 — cache Redis déterministe
      + filtre significativité + routing 8b/70b ; complete, détails findings.md § Patch-09)
- [x] patch-02 — Admin ops (implémenté 2026-06-01 — complete : scrape_runs/ai_runs CH
      + audit_log PG + instrumentation scrape/IA + routes admin allowlist + ops-health
      cron + dashboard /admin ; détails findings.md § Patch-02. Rebranchement cache
      `cached` NON fait — déféré, cf. findings)

## Étapes patch-09 (implémentées 2026-06-01)

- [x] 0 — env : UPSTASH_REDIS_REST_* (.env.local, déjà dans .env.example) +
      AI_CACHE_TTL_{CLASSIFY,ANALYZE,SCORE}_DAYS (.env.local + .env.example)
- [x] 1 — @outrival/shared : @upstash/redis dep + src/redis.ts (lazy, null si non config)
      + src/cache/ai-cache.ts (withAiCache, dégradation silencieuse, ne cache pas null)
- [x] 2 — @outrival/ai : src/filters/significance.ts (pur) + subpath ./significance
      + significance.test.ts (bun test, 8 verts) + tsconfig exclut *.test.ts
- [x] 3 — AI_CONFIG.classificationFast (llama-3.1-8b-instant) — pas de MODELS/ModelTier
- [x] 4 — cache + routing : classify (8b), score-overlap (8b), analyze-product (70b) ;
      signatures publiques inchangées (cache interne) ; PAS de cache sur signal/digest/
      battle-card (contrainte)
- [x] 5 — scrape-monitor : evaluateSignificance avant trigger classify-change (Change
      préservé) ; logAiRun skip (ai_runs absent → patch-02)
- [x] 6 — pnpm typecheck 7/7 ✓ + build 7/7 ✓ + bun test 8/8 ✓

### Décisions patch-09 (cf. findings.md § Patch-09 pour le détail)
- Backend = Upstash (REST joignable depuis Trigger.dev Cloud où tournent les workers ;
  Redis VPS exigerait une expo Internet). Réintroduit la dep retirée Phase 6, cache IA only.
- Routing via AI_CONFIG (pas de MODELS/ModelTier parallèle). Retour { result, cached }
  reporté à patch-02 (flag sans consommateur). Règle 4 (timestamps_only) = dead code
  masqué par règle 2, helper non modifié (patch-imposé, comportement correct).
- Commits laissés à l'utilisateur (working tree avait du WIP non lié patch-13/14 au
  démarrage → pas de git add -A pour ne pas mélanger).

## Étapes patch-08 (implémentées 2026-05-31 — commits laissés à l'utilisateur)

Working tree avait 102 fichiers WIP non commités au démarrage → décision utilisateur
"j'implémente, tu commites". Aucun commit fait par Claude. Détails dans findings.md
§ "Patch-08".

- [x] 0 — deps unpdf@1.6.2 + mammoth@1.12.0 dans @outrival/api
- [x] 1 — schéma org : projectStage, onboardingStep, onboardingSkipped + db:push (applied)
- [x] 2 — packages/ai/src/profile/ : fromDescription/fromDocument/fromRepo/fromUrl (purs)
- [x] 3 — routes /analyze-{url,description,document,repo} + /progress + /skip + helpers
          lib/github.ts + lib/extract-document.ts ; /analyze→/analyze-url (rename)
- [x] 4 — detectTemporaryUrl dans packages/shared/src/url.ts
- [x] 5 — onboarding-form.tsx réécrit (5 écrans) + page.tsx (resume + redirect guard)
- [x] 6 — OnboardingBanner + garde dashboard (completed OU skipped)
- [x] 7 — section re-onboarding dans WorkspaceSettingsForm (concurrents préservés)
- [x] 8 — zéro-stockage : sentry beforeSend + pino redact (req.body/*.file) + audit code
- [x] 9 — logique analyze isolée de l'auth (helpers réutilisables) — documenté
- [x] 10 — typecheck 7/7 ✓ + build 7/7 ✓ ; test E2E runtime = manuel (creds requis)

### Décisions patch-08

- packages/ai reste PUR : fetch (quickFetch/unpdf/mammoth/GitHub) côté API, ai ne reçoit
  que texte/artefacts. fromUrl = wrapper typé sur analyzeProduct.
- ProductProfile = type UNIQUE (réexporté depuis tasks/analyze-product), pas de duplicat.
- Discovery sans URL : findSimilarCompanies(productUrl: string|null) — query sémantique
  pilote Exa, URL sert juste à exclure le domaine propre.
- Resume : redirect dashboard seulement si completed && step==="done" → laisse passer skip
  + re-onboarding. Liste de concurrents non persistée → resume discover re-run discovery.
- Re-onboarding logé dans WorkspaceSettingsForm (pas de page settings/profile dédiée).

## Étapes patch-05 (terminées 2026-05-27)

- [x] Étape 0 — pnpm add html2canvas --filter @outrival/web + env OPS_SLACK_WEBHOOK_URL
- [x] Étape 1 — Schéma DB : table feedback + enums type/status + db:push --force
              (drop simultané des colonnes orphelines patch-03 :
              changes.summary, monitors.last_failed_at, monitors.last_error)
- [x] Étape 2 — packages/shared/notify.ts : sendSlackMessage helper (silencieux)
- [x] Étape 3 — apps/web/src/lib/feedback/error-buffer.ts : buffer 20 entrées
              (window.error + unhandledrejection + console.error wrapper)
- [x] Étape 4 — apps/api/src/routes/feedback.ts :
              · POST authMiddleware + Zod (5000 chars + screenshot 2MB cap)
              · screenshot data URL → R2 (feedback/{id}/screenshot.{jpg|png})
              · sendSlackMessage best-effort vers OPS_SLACK_WEBHOOK_URL
              · GET owner-only (db.users.role === "owner")
- [x] Étape 5 — apps/web/src/components/outrival/feedback-widget.tsx :
              · Bouton flottant fixed bottom-right (MessageSquarePlus)
              · Dialog shadcn : 3 tabs (bug/idea/other) + textarea + checkbox
                screenshot + texte d'info auto-capture (pageUrl + erreurs)
              · html2canvas dynamic import + JPEG q=0.7 + cast `(mod.default ?? mod)`
              · toast sonner confirmation
              · initErrorBuffer() au mount (idempotent)
              · monté dans dashboard/layout.tsx
- [x] Étape 6 — pnpm typecheck 6/7 ✓ (web a toujours les 16 erreurs
              pré-existantes patch-03, 0 nouvelle erreur introduite par patch-05)

## Décisions patch-05

- `sendSlackMessage()` dans @outrival/shared/notify (api ne peut pas importer
  workers — règles monorepo). Silencieux par design : try/catch swallow,
  ne JAMAIS faire échouer le POST feedback à cause d'un Slack down
- OPS_SLACK_WEBHOOK_URL distinct des `organizations.slackWebhookUrl` des orgs.
  À remplir en prod avec un webhook ops perso (Slack workspace privé)
- R2 best-effort sur le screenshot : si l'upload fail, on continue sans
  (insert feedback row sans screenshotR2Key) — l'utilisateur a quand même
  envoyé son message
- Le screenshot est OPTIONNEL et désactivé par défaut. Texte d'info explicite
  dans la modal : "La page actuelle et les erreurs techniques récentes sont
  jointes automatiquement" → opt-in éclairé
- html2canvas en dynamic import pour ne pas peser sur le bundle initial
  (~50KB gzipped). Chargé seulement quand l'utilisateur clique "Joindre une
  capture" ET clique Envoyer
- Buffer console : 20 entrées max, message tronqué à 500 chars. Wrap
  console.error + listen window error/unhandledrejection. initErrorBuffer()
  protégé par `installed = true` flag → safe à appeler plusieurs fois
- drizzle.config.ts modifié : auto-load .env.local via dotenv + tablesFilter
  pour exclure les tables Better Auth (user/session/account/verification).
  Sans ça, db:push planté sur prompts TTY introuvables. Le `--force` lors du
  push a aussi dropé les 3 colonnes orphelines patch-03 (changes.summary,
  monitors.last_failed_at, monitors.last_error) — cleanup de dette ratifié
  par l'utilisateur
- Vue riche feedbacks (filtres, table, statuts) reportée à patch-02 (admin ops)
- 16 erreurs TS pré-existantes du web restent — out of scope patch-05

## Étapes patch-03 (terminées 2026-05-27)

- [x] Étape 0 — posthog-js (@outrival/web) + posthog-node (@outrival/api,
              @outrival/workers) + env vars stub NEXT_PUBLIC_POSTHOG_KEY/HOST
              + POSTHOG_API_KEY/HOST → eu.i.posthog.com
- [x] Étape 1 — apps/web/src/lib/consent.ts (cookie ph_consent 6 mois) +
              components/outrival/consent-banner.tsx (Accepter/Refuser, design neutre)
- [x] Étape 2 — apps/web/src/lib/posthog/provider.tsx (init Cloud EU,
              opt_out_capturing_by_default, person_profiles "identified_only",
              maskAllInputs + data-ph-mask) + pageview.tsx (manual App Router
              capture) + integration root layout avec Suspense +
              data-ph-mask sur billing/settings/email user-menu
- [x] Étape 3 — apps/web/src/lib/posthog/events.ts (track/identify/reset
              gated par has_opted_in_capturing) + identify-sync.tsx server-driven
              + identifyUser sur login/signup + posthog.reset() sur logout
              (user-menu + onboarding signout)
- [x] Étape 4 — 10 events funnel client : user_signed_up, onboarding_*
              (started/product_analyzed/competitors_found/completed),
              competitor_added, scrape_triggered, battle_card_generated,
              paywall_shown + paywall_cta_clicked centralisés dans PaywallDialog
- [x] Étape 5 — apps/api/src/lib/posthog.ts + plan_upgraded/plan_cancelled
              dans stripe-webhook (distinctId = owner user de l'org) +
              apps/workers/src/lib/posthog.ts + signal_generated dans
              generate-signal.job avec shutdownPostHog() en fin de run
- [x] Étape 6 — useFeatureFlagEnabled("kill-switch-discovery") sur
              handleProfileConfirm — bloque l'appel Exa avec message de fallback
- [x] Étape 7 — pnpm typecheck ✓ pour shared/db/ai/scrapers/api/workers (6/7)
              · @outrival/web a 16 erreurs TS pré-existantes (lastFailedAt,
                lastError, refreshCompetitorSummary, classifyChange, stats,
                ChangeRow.summary/monitorUrl, CompetitorSignal.monitorUrl/
                sourceType, topbar.compact) — WIP utilisateur antérieur
                à patch-03, sans rapport avec PostHog. À nettoyer dans
                un commit séparé (l'API/types/components ont divergé)

## Décisions patch-03

- PostHog Cloud EU (eu.i.posthog.com) obligatoire — RGPD
- OPT-IN strict : opt_out_capturing_by_default true. Aucun event ni session
  replay avant clic "Accepter". Helper track() gate sur posthog.__loaded
  ET has_opted_in_capturing()
- person_profiles "identified_only" → pas de profil pour visiteurs anonymes
- userId comme seul distinctId — JAMAIS l'email comme propriété de personne
- maskAllInputs + maskTextSelector "[data-ph-mask]" sur session replay :
  appliqué sur user-menu email, section billing complète, settings
  notifications (digestEmail, slack webhook URL)
- Provider no-op si NEXT_PUBLIC_POSTHOG_KEY absent ou contient "REPLACE_ME"
  → dev local fonctionne sans key
- Server-side : flushAt=1 + flushInterval=0 + flush après chaque capture
  pour ne pas perdre d'events. Workers : shutdownPostHog() en fin de run
- pnpm.overrides {"@opentelemetry/api": "1.9.0"} ajouté au root package.json
  pour éviter le clash de versions drizzle-orm peer-resolution (trigger.dev
  pin 1.9.0, sentry pin 1.9.1). Sans override, workers typecheck échoue
  avec "Types have separate declarations of a private property"
- Better Auth : drizzleAdapter(db, { provider: "pg" }) sans schema option
  — Better Auth gère ses propres tables (user/session/account/verification),
  les passer comme schema requérait des exports drizzle inexistants
- Feature flag de démo : "kill-switch-discovery" — bloque l'appel Exa
  pendant l'onboarding avec message "Discovery temporarily disabled"
- distinctId server-side = owner user de l'org (premier user créé par
  createdAt ascending). Multi-user (business plan) viendra plus tard
- signal_generated track en fin de generate-signal.job, AVANT le shutdown.
  Pas de batch — chaque signal flush immédiatement

## Étapes patch-04 (terminées 2026-05-27)

- [x] Étape 0 — pino + @sentry/node + @sentry/esbuild-plugin + @sentry/nextjs
              installés + env vars stub LOG_LEVEL + SENTRY_DSN_* + SENTRY_AUTH_TOKEN
              + SENTRY_ORG dans .env.example et .env.local
- [x] Étape 1 — packages/shared/src/logger.ts (pino + redact PII) +
              childLogger helper + export depuis index.ts +
              remplacement console.error → logger.error dans clickhouse-safe.ts
              et stripe-webhook.ts (surgical, points critiques)
- [x] Étape 2 — apps/api/src/lib/sentry.ts (init Node SDK, enabled prod only,
              tracesSampleRate 0.1, sendDefaultPii false) + import en TOUT
              PREMIER dans index.ts + app.onError → captureException + logger.error
- [x] Étape 3 — apps/workers/src/lib/sentry.ts (idem API) + hook global
              onFailure dans trigger.config.ts → Sentry.captureException avec
              tags taskId+runId + @sentry/esbuild-plugin gated sur
              SENTRY_AUTH_TOKEN+SENTRY_ORG+NODE_ENV=production
- [x] Étape 4 — Next.js 16 pattern moderne (pas le wizard) :
              · src/instrumentation.ts (server/edge runtime detection)
              · src/instrumentation-client.ts (client init)
              · withSentryConfig dans next.config.ts (source maps automatiques)
              · Session Replay Sentry désactivé (replays*SampleRate: 0)
              · @sentry/nextjs ^10.54.0
- [x] Étape 5 — apps/api/src/routes/health.ts étendu :
              · GET /health/live (no deps, pour uptime monitors)
              · GET /health/ready (db SELECT 1 requis + clickhouse ping optionnel,
                redis skipped — Upstash retiré Phase 6) → 200/503
- [x] Étape 6 — findings.md : section Patch-04 complète (Sentry config,
              uptime monitoring TODO externe, règles Slack conservatrices,
              env vars à remplir en prod)
- [x] Étape 7 — Axiom log shipping : reporté (optionnel, free tier Coolify+Trigger.dev suffit)
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)

## Décisions patch-04

- Sentry DSN/Auth Token : stub dans .env.example/.env.local. À remplir en prod
  via dashboard Sentry (3 projets : outrival-api, outrival-workers, outrival-web)
- Next.js : pattern `src/instrumentation*.ts` (Next 15+) plutôt que
  `sentry.*.config.ts` au root (incompatible avec tsconfig rootDir=src)
- Wizard `pnpm dlx @sentry/wizard@latest -i nextjs` NON exécuté (modifie trop
  de fichiers, config manuelle plus chirurgicale)
- `console.error` remplacé chirurgicalement uniquement aux points critiques —
  workers utilisaient déjà logger de @trigger.dev/sdk
- `withSentryConfig` au lieu d'un import direct — gère source maps + tunneling
  + bundling auto en prod
- `tracesSampleRate: 0.1` (10%) pour rester dans le free tier Sentry
  (5k events/mois). Ajustable selon volume réel
- Session Replay Sentry DÉSACTIVÉ — PostHog patch-03 fera le replay
- `sendDefaultPii: false` partout — pas d'auto-capture des emails/IP/headers
- Redact pino : couvre passwords, tokens, apiKeys, secrets, auth headers,
  cookies, emails, stripeCustomerId, DATABASE_URL
- Health check `/ready` : db requis (503 si fail), clickhouse optionnel
  (200 + status "skipped" si CLICKHOUSE_URL absent — bon pour dev local)
- Hook onFailure global Trigger.dev (deprecated mais fonctionnel) — l'API
  recommended `tasks.onFailure` runtime sera adoptée si besoin de plus de
  granularité par job

## À faire avant beta (externe — utilisateur)

- Créer org Sentry + 3 projets → coller DSN dans .env prod
- Générer SENTRY_AUTH_TOKEN (Internal Integration scope: project:releases)
- Configurer Better Stack ou UptimeRobot :
  · monitor `https://api.outrival.io/health/live` (1/min)
  · monitor `https://outrival.io` (1/min)
  · alerte → email + Slack #alerts
- Sentry → Slack integration + règles conservatrices :
  · nouvelle issue → notif #alerts
  · pic >10 events/5 min même issue → notif #alerts
  · PAS d'alerte sur chaque occurrence (alert-fatigue)
- Test E2E avec NODE_ENV=production en local :
  · erreur API → visible dans outrival-api
  · job qui throw → visible dans outrival-workers
  · erreur client → visible dans outrival-web avec source maps
  · couper la DB → /health/ready → 503

## Étapes session actuelle (Phase 7 — terminée 2026-05-25)

- [x] Étape 0 — Install stripe + STRIPE_* placeholders dans .env.example/.env.local
- [x] Étape 1 — packages/shared : PLAN_LIMITS + PLAN_PRICING + PLAN_LABELS +
              types Plan, BillingPeriod, AlertChannel, PlanFeature
- [x] Étape 2 — apps/api/src/lib/plan.ts (helpers) + gating dans routes
              competitors, onboarding, candidates, battle-cards, settings
              + send-alert.job (notif RT + slack channel)
              → codes structurés : plan_limit_competitors, plan_locked_feature,
                plan_locked_source, plan_locked_frequency, plan_locked_channel
- [x] Étape 3a — DB schema : organizations.stripeSubscriptionId +
              billingPeriodEnum + organizations.planPeriod → db:push
- [x] Étape 3b — Routes Stripe :
              · apps/api/src/lib/stripe.ts (lazy getStripe + price ↔ plan map)
              · routes/billing.ts (GET, POST checkout, POST portal)
              · routes/stripe-webhook.ts (signature + 4 events handled)
              · monté à `/api/stripe/webhook` AVANT les autres `/api/*`
- [x] Étape 4 — UI billing : composant BillingDashboard (Client) +
              page /dashboard/settings/billing + lien depuis Settings
              · plan actuel + usage avec barre + tableau 4 plans + toggle period
              · redirect vers Stripe URL + ?status=success → toast + refresh
              · ApiError class dans lib/api.ts pour porter le code structuré
- [x] Étape 5 — Paywalls : PaywallDialog + paywallFromError(err)
              branchés sur 5 call sites :
              · createCompetitor (competitors page)
              · completeOnboarding (onboarding page)
              · addCandidate (candidates page)
              · generateBattleCard (battle-card-tab)
              · updateNotificationSettings (notification-settings-form)
- [x] Étape 6 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 7 — Mise à jour planning

## Décisions Phase 7

- PLAN_LIMITS = source unique de vérité dans @outrival/shared (utilisé par
  api gating, web billing UI, paywalls, et workers send-alert)
- business.maxCompetitors = Number.POSITIVE_INFINITY ; UI affiche "illimité"
  et envoie `limit: null` côté JSON (Number.POSITIVE_INFINITY n'est pas
  serializable JSON, le helper `Number.isFinite(...)` est utilisé)
- Webhook monté à `/api/stripe/webhook` AVANT les routes `/api/*` (Hono ne
  cause pas de body-consumption issue avec les middlewares actuels mais
  pattern défensif). Pas dans authMiddleware → signature Stripe = preuve
- Stripe SDK v22 : `apiVersion: "2026-04-22.dahlia"` (la version du doc
  était trop ancienne). Types via inference (`InstanceType<typeof Stripe>`,
  `Extract<EventType, {type:"x"}>["data"]["object"]`) pour contourner la
  shape pénible du namespace export en CJS
- Customer Stripe créé à la première checkout (lazy) — pas de pre-creation
  au signup. metadata.orgId présent sur Customer + Session + Subscription
  → 3 sources de vérité pour retrouver l'org dans le webhook
- Le webhook gère 4 events : checkout.session.completed,
  customer.subscription.created/updated/deleted. Pour created/updated, on
  re-derive le plan depuis le priceId du subscription via lookupPlanByPriceId.
  Pour deleted, repasse en free + clear subscriptionId + planPeriod
- ApiError côté web : nouvelle classe qui porte `status`, `code` (string),
  `data` (payload JSON parsé). paywallFromError(e) renvoie null pour les
  non-paywalls → fallback à l'erreur classique
- PaywallDialog : un seul composant pour tous les codes plan_* avec
  switch sur reason.code → bon copy en français + bouton "Voir les plans"
  qui link vers /dashboard/settings/billing. Position fixed, fermable
- Gating send-alert.job (workers) : si !realtimeAlerts → pas d'insert
  notification (donc free user ne voit pas la bell). Slack/webhook
  filtrés par `isChannelAllowed`. Email digestEmail reste toujours envoyé
  (channel "email" autorisé sur tous les plans)
- Stripe en mode test pour cette phase ; les vraies clés + price IDs
  seront remplies par l'utilisateur dans .env.local avant le test E2E

## À tester (runtime)

- Compte free : tenter d'ajouter un 3e concurrent → paywall "limit_competitors"
- Compte free : tenter de générer une battle card → paywall "locked_feature"
- Settings : tenter de sauver une URL Slack en free → paywall "locked_channel"
- Stripe test mode (carte 4242 4242 4242 4242) :
  1. Créer 3 produits Starter/Pro/Business avec prix monthly + yearly
  2. Coller les price IDs dans .env.local
  3. Souscrire au plan Pro depuis /dashboard/settings/billing
  4. Au retour ?status=success → toast + refresh → org.plan = pro
  5. Vérifier qu'on peut ajouter jusqu'à 15 concurrents et générer une battle card
  6. Ouvrir le Customer Portal → annuler l'abonnement
  7. Vérifier que org.plan repasse en free via webhook subscription.deleted

## Étapes session précédente (Phase 6 — terminée 2026-05-25)

## Étapes session actuelle (Phase 6 — terminée 2026-05-25)

- [x] Étape 1 — Schémas DB : battle_cards, notifications (+ enum), competitor_candidates (+ enum) + db:push
- [x] Étape 2 — packages/ai : generateBattleCard (Groq via AI_CONFIG.insights, Zod schema)
- [x] Étape 3 — Workers : generate-battle-card.job (gather context → Groq → upsert → Playwright PDF → R2)
              + lib/battle-card-html.ts (template A4 Outrival dark/amber)
              + getBytesFromR2 helper (packages/shared) + playwright en dep workers
- [x] Étape 4 — API : 4 routes /api/competitors/:id/battle-card (GET, generate, PATCH, GET pdf)
- [x] Étape 5 — UI : onglet "Battle Card" + composant BattleCardTab (édition inline,
              polling 3s pendant génération, DL PDF, régénérer)
- [x] Étape 6 — Notifications SSE :
              · send-alert.job : insert notification (surgical, 7 lignes)
              · routes/notifications.ts : list, unread-count, read, read-all, stream(SSE)
              · components/notifications-bell.tsx + header dans dashboard layout
              · DB-backed, latence ~3s, EventSource auto-reconnect
- [x] Étape 7 — detect-new-competitors.job (cron `0 20 * * 0`) :
              · findSimilarCompanies + scoreOverlap pour chaque org onboardée
              · dedup par URL ET hostname normalisé (existing + seen candidates)
              · insert candidate + notification si overlap > 65
              · routes/candidates.ts (list, add, dismiss)
              · /dashboard/candidates + entrée sidebar "Détections"
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 9 — Mise à jour planning

## Décisions Phase 6

- Temps-réel via SSE DB-backed (`hono/streaming.streamSSE`) — pas d'Upstash
  pub/sub ni service payant. Latence 2-3s amplement suffisante pour veille
- PDF Playwright via `chromium.launch({headless:true})` + page.pdf({format:"A4"})
  → buffer → upload R2 (jamais en DB). Régénération uniquement à la demande
- Helper `getBytesFromR2(key) → Uint8Array` ajouté à @outrival/shared
  (au lieu de string) pour servir binaires via Response Hono
- battleCardsRouter monté à `/api/competitors` à côté de competitorsRouter
  (deux routers même prefix, dispatch par chemin distinct `/:id/battle-card`)
- Dedup candidates double-vérifié : exact URL set + normalized hostname set
  (sans www) car Exa retourne parfois différents formats pour le même site
- send-alert modif surgical : 7 lignes en plus (insert dans table notifications)
  pour ne pas casser la robustesse Slack/email existante
- Battle card content = jsonb editable inline (pas de schéma de validation
  duplicaté côté UI, juste Zod côté API)
- Bell + toast positionnés en `position:fixed bottom-right` pour les toasts,
  dropdown ancré au bouton bell dans le header (z-50)

## Étapes session précédente (Phase 5 — terminée 2026-05-25)

- [x] Étape 0 — Deps (@clickhouse/client ajouté à @outrival/db)
- [x] Étape 1 — Tables ClickHouse (client partagé `ch` + ensureClickhouseTables + script `pnpm ch:setup`)
- [x] Étape 2 — Schéma : competitors.aiSummary + aiSummaryUpdatedAt
- [x] Étape 3 — packages/ai : extract-pricing, extract-jobs, extract-reviews, competitor-summary (Groq)
- [x] Étape 4 — packages/scrapers : jobs (Playwright + ATS detection), g2-reviews + capterra-reviews (ScrapingBee premium)
- [x] Étape 5 — Workers : 4 nouveaux jobs + routing surgical depuis scrape-monitor
- [x] Étape 6 — API : 6 sous-routes /:id/{jobs,job-trends,reviews,review-scores,pricing-history,signals} + enrichissement /:id
- [x] Étape 7 — UI : fiche concurrent complète (5 onglets, recharts dark amber)
- [x] Étape 8 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 9 — Mise à jour planning

## Décisions Phase 5

- Client ClickHouse partagé dans `packages/db/src/clickhouse.ts` (proxy lazy)
  pour permettre l'usage depuis l'API ET les workers
- Workers conservent leur propre `lib/clickhouse.ts` avec logger Trigger.dev
  (helpers insert best-effort par table : pricing_history, job_counts,
  review_scores, signal_feed)
- API : helper `chQuery` best-effort retourne [] si CLICKHOUSE_URL absent
  → la fiche concurrent reste fonctionnelle sans ClickHouse provisioned
- Reviews : on stocke praises et complaints dans la table `reviews` Postgres
  avec `author = "praise" | "complaint"` (pas idéal, à normaliser Phase 6+)
- Routing scrape-monitor 100% surgical : 4 lignes en plus pour brancher
  pricing/jobs/g2/capterra vers les jobs d'extraction
- Tabs custom (pas de shadcn Tabs installé) — design flat + underline amber
- Recharts pour pricing timeline, job trends, review scores
- G2 / Capterra forcés via ScrapingBee premium_proxy + render_js=true
- Détection ATS (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters)
  stockée dans metadata.atsDetected mais non utilisée pour scraper l'iframe
  (Phase 6+ si besoin)

## Étapes session précédente (Phase 4 — terminée 2026-05-25)

- [x] Étape 0 — Deps (exa-js + EXA_API_KEY + SCRAPINGBEE_API_KEY placeholder)
- [x] Étape 1 — Schéma org : productUrl, productProfile (jsonb), onboardingCompleted
- [x] Étape 2 — packages/ai : analyzeProduct + scoreOverlap (Groq, batché, camelCase)
- [x] Étape 3 — packages/scrapers : findSimilarCompanies (Exa) + quickFetchText (ScrapingBee no-JS) + subpath exports
- [x] Étape 4 — Routes API synchrones : /onboarding/{status,analyze,discover,profile,complete}
- [x] Étape 5 — UI : page client unique 5 étapes (state machine + spinners amber)
- [x] Étape 6 — Garde dashboard layout (redirect /onboarding si !completed)
- [x] Étape 7 — pnpm build ✓ (7/7) + pnpm typecheck ✓ (7/7)
- [x] Étape 8 — Mise à jour planning

## Décisions architecturales

- Pipeline IA 100% Groq pour Phase 3 (llama-3.3-70b-versatile) — swap vers
  Claude prévu en changeant une seule ligne dans `packages/ai/src/config.ts`
- ClickHouse insert best-effort partout : skip + log si CLICKHOUSE_URL non set
- Idempotence Signal : check `signals.changeId` avant insert (classify + generate)
- Phase 5 : ClickHouse client partagé dans packages/db (proxy lazy)
- env aiEnv() lazy : ne parse les vars qu'au premier appel pour ne pas crasher trigger:dev
- ProductProfile camelCase partout (Phase 4)
- Discovery ne crée RIEN en DB — seul /complete crée competitors + monitors
- Pour les sources G2/Capterra : URL fournie par l'utilisateur via monitor.config
  (auto-discovery G2 URL = Phase 6 si besoin)

## À faire avant Phase 6

- Provisionner ClickHouse Cloud + lancer `pnpm ch:setup` une fois pour
  créer les 4 tables (pricing_history, job_counts, review_scores, signal_feed)
- Test E2E : ajouter monitors pricing+jobs+g2_reviews sur un concurrent réel,
  scraper manuellement, vérifier les onglets de la fiche
- Mesurer la fiabilité du scraping G2/Capterra via ScrapingBee
- Évaluer la qualité de l'extraction Groq sur des pages réelles
  (pricing structuré, jobs par département, top complaints reviews)
- Déclencher refresh-competitor-summary manuellement → vérifier aiSummary
- Vérifier la détection des offres fermées (réexécuter extract-jobs deux fois
  avec un job supprimé entre les deux)

## Blockers

Aucun. Phase 5 livrable end-to-end. Reste creds ClickHouse à fournir pour
runtime + URLs G2/Capterra par concurrent (monitor.config) à configurer
côté UI (Phase 6).

---

# Patch 11 — Détection avancée du pricing (taxonomie 6 statuts)

## Session du 2026-06-01

## Objectif
Remplacer le binaire "prix trouvé / pas trouvé" par une taxonomie à 6 statuts
(public · public_partial · gated_demo · gated_signup · dynamic · unknown),
détecter les promos pour ne JAMAIS générer de signal de changement de prix
quand promotional=true, et générer un signal "pricing repositionné" sur
transition de statut. Validé sur fixtures HTML réelles (Linear, Notion,
Crayon, Segment), pas seulement en théorie.

## Phase en cours
Post-MVP — Patch 11 (s'appuie sur le pricing construit en Phase 5)

## Réalité du code vs hypothèses du patch (divergences à acter)
Le patch décrit des chemins/structure supposés de Phase 5 qui ne correspondent
pas au code réel. Adaptations :

1. Scraper réel = `packages/scrapers/src/pricing/pricing.scraper.ts`
   (pas `scrapers/pricing.ts`). Il ne fait QUE fetch le HTML (Playwright).
2. L'extraction des tiers n'est PAS dans le scraper : elle vit dans le job
   worker `extract-pricing.job.ts` + l'IA `packages/ai/extractPricing()`,
   qui écrit dans ClickHouse `pricing_history`. → On NE met pas `tiers` dans
   le scraper ; les tiers restent extraits par l'IA dans le worker.
3. Aucune donnée pricing sur `competitor` aujourd'hui → les 6 champs de statut
   vont sur la table `competitors` (Postgres), conformément à l'option du patch.
4. Pas de `competitor-pricing-card.tsx` : le `PricingTab` est inline dans
   `app/dashboard/competitors/[id]/page.tsx` (~l.1439). On y ajoute une carte
   statut + override manuel.
5. Aucun test runner dans le repo (pas de vitest). Bun 1.3.13 dispo →
   `bun test` zero-config dans le package scrapers + fixtures HTML réelles.
6. cheerio n'est pas dép directe → `pnpm add cheerio --filter @outrival/scrapers`.
7. `PricingStatus` (type) + `detectPricingRepositioning()` → `@outrival/shared`
   (importable scrapers/workers/web), PAS packages/ai. Les détecteurs HTML
   (signals, determine-status, discover-url) restent dans scrapers.
8. `signals.changeId` est notNull + FK → tout signal s'accroche à une `change`.
   Donc pour un changement sur monitor pricing, scrape-monitor route vers UN
   seul résultat : promo→aucun signal · transition→signal repositionné ·
   sinon→classify-change générique. (Évite la race de double-signal sur le
   même changeId.)

## Statut : COMPLETE (2026-06-01)
Typecheck 7/7 ✓ · build 7/7 ✓ · 45 tests bun verts · db:push + ch:setup appliqués.
Étapes 4+5 fusionnées (couplées, add -A) ; 8 faite avant 7 (dépendance generate-signal).
Reste : run E2E live (creds GROQ/R2/DB + Trigger.dev) non exécuté ici.

## Étapes (1 commit par étape)
- [x] Étape 1 — Schéma : 6 champs pricing sur `competitors` + ClickHouse
      pricing_history (status/promotional/observed_region, ALTER IF NOT EXISTS).
      db:push + ch:setup OK. → `feat(db): add pricing status taxonomy fields`
- [x] Étape 2 — `@outrival/shared` : `PRICING_STATUSES` (tuple) + `PricingStatus`
      (dérivé) + `detectPricingRepositioning`. → `feat(shared): pricing status type…`
- [x] Étape 3 — scrapers/pricing/discover-url.ts (cheerio, + dép cheerio).
      → `feat(scrapers): multi-strategy pricing URL discovery`
- [x] Étape 4+5 — signals.ts + determine-status.ts + bun test + 4 fixtures réelles.
      → `feat(scrapers): pricing signal detectors + status taxonomy`
- [x] Étape 6 — Découverte branchée dans pricing.scraper.ts + helper pur
      `analyzePricingHtml` + subpath `@outrival/scrapers/pricing`.
      → `feat(scrapers): refactor pricing scraper around status taxonomy`
- [x] Étape 8 — generate-signal accepte `pricingTransition` + insight dédié.
      → `feat(ai): detect pricing status repositioning signals`
- [x] Étape 7 — scrape-monitor : analyse, stockage (sauf override), routage
      promo/transition/générique, status→extract-pricing→ClickHouse.
      → `feat(workers): integrate pricing taxonomy and skip promotional signals`
- [x] Étape 9 — CompetitorPricingCard (6 variantes + région + note + demo) +
      modal override + routes PUT /pricing & POST /pricing/redetect.
      → `feat(web): adapt competitor pricing card to status taxonomy`
- [x] Étape 10 — Vérif finale OK, findings.md + task_plan.md à jour.

## Décisions prises
- Détection lancée dans scrape-monitor (sur result.html en mémoire) car le
  promo-gate ET le routing de transition doivent décider AVANT classify-change.
  Les tiers restent extraits par l'IA dans extract-pricing.
- Fixtures = HTML rendu réel capturé via le scraper Playwright existant
  (sites JS-heavy → un curl statique renverrait un shell sans prix → faux unknown).

## Blockers
- Capture de fixtures = lancer Playwright (4 pages). MEMORY: full `pnpm dev`
  OOM la VM WSL 7.4GB → capture en isolé (4 fetch), pas tout le stack.

---

# Patch 12 — Monitoring du produit utilisateur (self-competitor)

## Session du 2026-06-01

## Objectif
Traiter le site user comme un "concurrent spécial" (type="self", isUserProduct=true) :
fiche "Mon produit" riche et éditable, enrichissement Phase 5 réutilisé, changements
détectés routés vers self_product_changes (JAMAIS de signal classique), re-scan
périodique + re-discovery proposée sur changement majeur.

## Décisions périmètre (validées avec l'utilisateur)
- Q1=B : fiche complète (mockup 1:1) → extraction IA features + stack technique
  (nouveau prompt @outrival/ai) + stockage jsonb `selfProfile` par champ.
- Q2=A : j'implémente + typecheck/build verts, commits laissés à l'utilisateur
  (working tree a du WIP patch-11 non commité → pas de git add -A).

## Divergences réelles vs patch (adaptées)
1. Pas de `enrich-competitor.job`. Enrichment = monitors (homepage/pricing/jobs) +
   scrape-monitor force par monitor (pattern de /complete) + refresh-competitor-summary.
2. Le signal se déclenche dans classify-change.job (pas scrape-monitor) → interception
   du self là (type==="self" → self_product_changes + notif, return avant generate-signal).
3. Skip reviews self = pas de monitor reviews créé pour le self (+ garde scrape-monitor).
4. Web sous dashboard/ → app/dashboard/my-product/page.tsx.
5. Pas de productName/productRepoUrl sur org → self gated par org.productUrl seul ;
   nom dérivé du hostname.
6. selfProfile jsonb par champ { value, isFromAutoDetect, lastEditedByUserAt } (la table
   competitor_profiles du patch n'existe pas) ; pricing reste sur champs patch-11.

## Étapes (commits laissés à l'utilisateur)
- [x] 0 — env USER_PRODUCT_RESCAN_DAYS=14 (.env.example + .env.local)
- [x] 1 — schéma : competitors.type + isUserProduct + selfProfile(jsonb) ;
      notification_type += "self_change" ; table self_product_changes (+ changeId unique,
      summary, enums status/severity) ; index.ts ; db:push OK
- [x] 2 — /complete : helper createSelfCompetitor (idempotent, gated org.productUrl) +
      monitors homepage/pricing/jobs (weekly, nextRunAt seed RESCAN_DAYS) + scrape force
- [x] 3 — extractSelfProfile (ai, features+stack, 70b) + extract-self-profile.job
      (trigger homepage self ; merge préserve les champs édités) + garde reviews self
- [x] 4 — classify-change : branche self → determineSelfChangeSeverity + insert
      self_product_changes (idempotent par changeId) + notifySelfChange ; AUCUN signal
- [x] 5 — API my-product.ts : GET / PATCH / POST rescan / GET changes /
      changes/:id/{accept,modify,ignore} ; monté /api/my-product
- [x] 6 — UI dashboard/my-product (EditableText/EditableList, pending changes,
      modal re-discovery) + nav "My product" (sidebar) + loading.tsx
- [x] 7 — re-discovery : accept(major) → suggestion → modal → api.detectCandidates()
      (reuse détection existante, préserve les concurrents). "re-score existing" déféré.
- [x] 8 — re-scan : monitors self (weekly) ramassés par schedule-scraping +
      bouton "Re-scan" (POST /rescan, force) — aucun code dédié nécessaire
- [x] 9 — exclusion self (ne type='self') : liste competitors, search, changes feed,
      quota. Discovery déjà couverte (self dans existing → dédup + Exa exclut productUrl)
- [x] 10 — typecheck 7/7 ✓ + build 7/7 ✓

## patch-12 = COMPLETE (implémenté 2026-06-01, commits laissés à l'utilisateur)

### Déférés (notés dans findings)
- Édition inline du pricing sur /my-product (PATCH le supporte ; UI read-only — le
  competitor pricing tab patch-11 couvre déjà l'override). 
- Battle card "côté nous" depuis selfProfile (utilise encore org.productProfile, OK).
- Re-discovery "re-score des concurrents existants" (on ajoute des suggestions +
  préserve, sans recalculer l'overlap des existants).
- Email sur self_change (in-app notification seulement ; pas de Resend dupliqué).

## Blockers patch-12
- Aucun. Test E2E runtime (onboarding live → self créé → enrich → /my-product) =
  manuel, nécessite services + creds (GROQ/EXA/R2/DB + Trigger.dev).

---

# Patch 14 — Trust & clarity (divulgation progressive)

## Session du 2026-06-01

## Objectif
3 trous UX sous un principe directeur DIVULGATION PROGRESSIVE :
1. Confiance signal — 3 niveaux (source line inline / why-panel sur clic / admin brut).
2. Freshness — pastilles colorées par section + tooltip date (pas de timestamp inline).
3. Erreurs — système cohérent (global-error Sentry + toasts sonner + format API),
   messages en 3 parties (passé / présent / action user).
JAMAIS de HTML brut, jamais de stack/SQL/chemin visible user. **UI 100% anglais**
(règle language.md override les strings FR du patch).

## Décisions périmètre (validées avec l'utilisateur)
- UI en anglais (les exemples FR du patch sont traduits).
- Commits laissés à l'utilisateur — j'implémente + typecheck/build verts par étape.

## Divergences réelles vs patch (adaptées AVANT de coder)
- `signals` n'a NI `title` NI `detectedAt` → API detail utilise `insight`/`category`
  + `createdAt`. Pas de `title` inventé.
- Classification réelle = `{ category, severity, is_significant, reason }` (pas le
  `type:"pricing_decrease"` du patch). On AJOUTE `humanChangeBefore/After` nullable.
- 2 chemins vers un signal : classification générique ET `pricingTransition` (patch-11).
  Before/After humain = via classify pour le 1er ; dérivé des statuts pour le 2e.
- Cache patch-09 : `withAiCache` retourne l'objet stocké SANS re-valider → champs en
  `.nullable().optional()`, même clé (hash diff) → compatible.
- `GET /competitors/:id` retourne DÉJÀ `monitors` (lastRunAt/lastFailedAt/sourceType)
  + `recentSignals` (sourceType + monitorUrl) → freshness par section dérivée côté web,
  pas de changement API détail. Seuls la LISTE (`GET /`) + le nouveau
  `GET /signals/:id/detail` touchent l'API.
- Toast = **sonner** (déjà monté `app/layout.tsx`), PAS un `<Toast>` shadcn neuf.
- `lib/scrape-errors.ts` (humanisation) existe déjà → on l'étend / réutilise, on ne
  duplique pas. Nouveau `lib/error-helpers.ts` = mapping codes API → config UI.
- ErrorBoundary "root" = idiome Next App Router → `app/global-error.tsx` (+ amélioration
  du `app/dashboard/error.tsx` existant), pas une classe montée à la main.
- Typo réelle = Bricolage Grotesque + DM Mono → `font-mono` (var existante), pas de nom
  de police hardcodé. Tokens `bg-{positive,high,medium,critical}` confirmés (@theme).
- patch-02 (vue admin brute) PAS encore fait : on ne construit que l'endpoint user-safe.

## Étapes
- [x] 0 — shared/constants/freshness.ts (FRESHNESS_THRESHOLDS + computeFreshness + aggregateFreshness purs) — no commit
- [x] 1 — schéma signals += human_change_before/after (nullable) + db:push applied
- [x] 2 — classify.ts (schema+prompt EN) + generate-signal persiste humanChange* (2 chemins) + PRICING_STATUS_LABELS
- [x] 3 — API GET /signals/:id/detail (user-safe) + freshness agrégée sur GET /competitors + lib/errors.ts
- [x] 4 — SignalSourceLine (N1) + WhyInsightPanel (N2) + source-labels + getSignalDetail + intégration signal-card
- [x] 5 — FreshnessDot (4 niveaux + tooltip) + fiche concurrent (TabsTrigger par source) + liste (dot global)
- [x] 6 — erreurs : global-error.tsx (Sentry) + dashboard/error.tsx + api lib/errors.ts + web error-helpers.ts
         + ListError + toasts sonner 3-parties + fix skeleton-infini-sur-erreur (signals/competitors)
- [x] 7 — passe transversale : fiche concurrent (SignalSourceLine ActivityTab + toasts), overview,
         my-product/candidates/digests/alerts/notif-settings/pricing-card (toasts + ListError + écrans propres)
- [x] 8 — typecheck 7/7 ✓ + build 7/7 ✓ + bun test 18/18 ✓ + findings.md à jour

## patch-14 = COMPLETE (implémenté 2026-06-01, commits laissés à l'utilisateur)

Commits suggérés (1 par étape) :
- `feat(db): add human-readable change description to signals`
- `feat(ai): extract human-readable before/after on classification`
- `feat(api): expose user-safe signal detail and per-source freshness`
- `feat(web): add progressive signal traceability (source line + why panel)`
- `feat(web): add subtle freshness indicators with progressive tooltip`
- `feat(web): add coherent error handling with progressive disclosure`
- `feat(web): apply trust and clarity patterns across main views`

### Déférés (cf. findings.md § Patch-14)
- Fuites `Error:{error}` restantes dans sheets settings (detection/digest/alert-channels) +
  billing-dashboard + workspace-settings-form (lower-traffic, même pattern mécanique à appliquer).
- FreshnessDot /my-product (besoin freshness self côté API), source line sectorielle (patch-13,
  multi-concurrents), SignalSourceLine sur battle cards (citent des insights agrégés).
- `ui/dialog.tsx` "Fermer" FR = dette pré-existante (hors périmètre).

## Blockers patch-14
- Aucun pour l'implémentation. Tests E2E runtime (signal réel avec humanChange,
  scrape failed → pastille rouge, erreur API → toast) = manuels, creds requis.

---

# Patch 13 — Intelligence sectorielle depuis les données existantes

## Session du 2026-06-01

## Objectif
Couche **méso** : croiser les concurrents d'une MÊME org pour détecter des tendances
sectorielles (vagues de features, recrutement, dérive pricing, repositionnement),
formulées par IA. Distinct des signals micro. AUCUNE source externe, AUCUNE
agrégation cross-org, AUCUNE prédiction.

## Politique de session (validée)
- "Plan d'abord, validation ensuite" → ce plan attend l'OK avant tout code.
- "Tu commites" (comme patch-11/12) : j'implémente + typecheck/build verts, AUCUN
  commit fait par moi (auto-committer concurrent observé — il a d'ailleurs ajouté la
  section patch-14 ci-dessus pendant cette session). `git add -A`/commit = user.

## Divergences spec ↔ code réel (vérifiées AVANT de planifier)
1. **`logAiRun`/table `ai_runs` (patch-02) N'EXISTENT PAS** (grep vide). Le spec
   appelle `await logAiRun("formulate_sectoral", …)`. → REMPLACÉ par `logger.info`
   structuré dans le job. La case verif "ai_runs loggue formulate_sectoral" devient
   "logger.info loggue chaque formulate_sectoral".
2. **Provider IA** : `import { complete } from "../provider"` (pas `../provider/groq`),
   signature `complete(config, opts)` avec `config` ∈ `AI_CONFIG`. Modèle "smart" 70b
   = `AI_CONFIG.insights`. `safeParseJson(raw, zodSchema)`. Pas de cache (provider n'en
   a pas ; spec dit "PAS de cache" → rien à faire).
3. **Pas de catégorie `feature_added`** : la classif réelle = pricing|product|hiring|
   reviews|content|funding. Les "features ajoutées" = `signals` de `category="product"`.
   → `detectFeatureTrends` lit les `signals` (déjà classifiés + significatifs) et
   regroupe par **thème via buckets de mots-clés** (pur, sans IA).
4. **Statut pricing SANS table d'historique Postgres** (`competitors.pricing_status` =
   état courant uniquement). MAIS ClickHouse `pricing_history` **a `status` + `price` +
   `recorded_at`** (patch-11). → détecteurs pricing/positioning lisent CH. Les workers
   PEUVENT query CH (`queryBestEffort` privé) → j'ajoute des query helpers exportés.
   CH best-effort : si `CLICKHOUSE_URL` absent → null → ces 2 détecteurs ne produisent
   rien (skip propre). Documenté.
5. **`org.productProfile`** = `{ category, audience, valueProp, pricingModel }` → fournit
   exactement `category`+`audience` pour le userContext de la formulation.
6. **Jobs auto-découverts** via `dirs: ["./src/jobs"]` (trigger.config.ts) → créer le
   fichier suffit. Cron Trigger.dev = **statique** → `SECTORAL_ANALYSIS_DAY` ne peut pas
   piloter le cron dynamiquement → cron hardcodé `0 7 * * 1` (lundi 7h) ; l'env var est
   documentée mais non câblée (noté). `SECTORAL_MIN_COMPETITORS` + `SECTORAL_MIN_CONFIDENCE`
   lues au runtime (worker env.ts, avec defaults).
7. **Détecteurs purs exportés depuis la racine `@outrival/ai`** (pas de subpath
   `@outrival/ai/sectoral` — l'index re-exporte déjà classify/insight/digest ; les
   workers importent déjà `@outrival/ai`). Évite de configurer package.json exports.
8. **Nom de fichier schéma** : `sectoral_signals.ts` (underscore, comme job_postings /
   battle_cards / self_product_changes), pas `sectoral-signals.ts` du spec.
9. **API read/dismiss** : le spec dit POST ; signals.ts existant utilise PATCH. → je
   suis le spec (POST /:id/read, POST /:id/dismiss) pour rester fidèle ; trivial.
10. **Digest** : `generateDigest(signals)` + `renderDigestEmail` existants. J'étends le
    schéma/prompt/render avec une section optionnelle. Le skip "0 signal micro → pas de
    digest" RESTE (une semaine sectorielle-seule n'enverra pas d'email ; visible sur le
    dashboard). Noté comme limite assumée.

## Étapes (1 commit/étape → laissés à l'utilisateur)
- [x] 0 — Env : `.env.example` + `.env.local` += SECTORAL_ANALYSIS_DAY/MIN_COMPETITORS/
      MIN_CONFIDENCE ; worker env.ts += MIN_COMPETITORS (coerce int ≥2 def 4) +
      MIN_CONFIDENCE (coerce 0-1 def 0.6). (pas de commit)
- [x] 1 — Schéma `packages/db/src/schema/sectoral_signals.ts` + index.ts + `db:push`
      OK (table + enum `sectoral_category` créés, "Changes applied").
- [x] 2 — `packages/ai/src/sectoral/{types,detectors}.ts` (4 détecteurs purs, buckets
      mots-clés par token anti-faux-positif) + `detectors.test.ts` `bun test` 10/10 ✓ +
      export index.ts.
- [x] 3 — `packages/ai/src/sectoral/formulate.ts` (AI_CONFIG.insights, json, Zod
      {title,insight}, prompt EN, grounding evidence, no forecasting) + export index.ts.
- [x] 4 — `apps/workers/src/jobs/analyze-sectoral.job.ts` (cron `0 7 * * 1`,
      loadOrgSectoralData PG+CH, skip <MIN, try/catch/org, filtre confidence, idempotence
      7j sur evidence.metric, logger.log formulate_sectoral) + 2 query helpers CH.
- [x] 5 — `apps/api/src/routes/sectoral.ts` (GET / org-scoped non-dismissed DESC ?limit,
      POST /:id/read, POST /:id/dismiss) monté `/api/sectoral`.
- [x] 6 — UI `SectoralSignalsSection` + card + modal evidence dans OverviewView (section
      "🌍 Sector trends" distincte, masquée si vide) + `api.listSectoral/markSectoralRead/
      dismissSectoral` + type `SectoralSignal`.
- [x] 7 — Digest : `DigestSchema.sectoralTrends` optionnel + `renderDigestEmail` section
      séparée + job charge sectoral non lus/non dismissed → `digest.sectoralTrends`
      (attaché APRÈS generateDigest, pas re-passé dans l'IA).
- [x] 8 — Garde-fous + seuils + formules confidence documentés dans findings.md.
- [x] 9 — `pnpm typecheck` 7/7 ✓ + `pnpm build` 7/7 ✓ + `bun test` 10/10 ✓.
      findings.md/task_plan.md à jour.

## patch-13 = COMPLETE (implémenté 2026-06-01, commits laissés à l'utilisateur)
E2E runtime (déclenchement réel du job, données CH historiques, email digest) = manuel,
nécessite services + creds (GROQ/CH/DB + Trigger.dev). Voir findings "Runtime TODO".

## Décisions prises
- detectFeatureTrends source = `signals` product (déjà significatifs) + buckets mots-clés,
  PAS une catégorie `feature_added` inexistante.
- Pricing/positioning lisent ClickHouse pricing_history (status+price patch-11), pas
  Postgres ; best-effort → skip propre si CH absent.
- logAiRun supprimé (patch-02 jamais implémenté) → logger.info.
- Détecteurs purs exportés depuis la racine @outrival/ai (pas de subpath).
- Cron statique lundi 7h ; SECTORAL_ANALYSIS_DAY documenté mais non câblé.

## Blockers
- Aucun bloquant. CH requis pour 2 des 4 détecteurs (pricing/positioning) — sans CH,
  seuls feature/hiring tournent. Test E2E runtime = manuel (services + creds).

---

# Patch 02 — Admin ops (observabilité backend)

## Session du 2026-06-01

## Objectif
Tour de contrôle interne gatée à l'allowlist `ADMIN_EMAILS` (PAS le role owner) :
santé scraping/IA, coût (estimations), feedbacks (vue riche patch-05), debug user
+ force scrape, audit log, alertes Slack ops conservatrices.

## Politique de session
"Je code, tu commites" (comme 11-14) : typecheck/build verts par étape, AUCUN
commit fait par Claude.

## patch-02 = COMPLETE (2026-06-01)
Typecheck 7/7 ✓ · build 7/7 ✓ · ch:setup OK (scrape_runs + ai_runs) · db:push OK
(audit_log) · requêtes CH+PG smoke-testées sur l'instance réelle.

## Étapes
- [x] 0 — env ADMIN_EMAILS (.env.example + .env.local) — pas de commit
- [x] 1 — CH scrape_runs + ai_runs dans ensureClickhouseTables (préfixe ${DATABASE}.)
- [x] 2 — PG table audit_log + schema/index.ts + db:push
- [x] 3 — logScrapeRun (lib) + instrumentation scrape-monitor (3 points + onFailure)
- [x] 4 — logAiRun (lib) + instrumentation classify/insight/digest/battle_card
- [x] 5 — adminMiddleware (allowlist) + routes/admin.ts (overview, scraping-health,
      ai-health, cost, users, users/:id, force-scrape, feedback, feedback/:id/screenshot,
      audit-log) + audit_log sur view_user/force_scrape/update_feedback + mount API
- [x] 6 — ops-health-check.job.ts (cron 6h, seuils conservateurs, Slack groupé)
- [x] 7 — UI app/(admin)/admin (page.tsx gate allowlist serveur → 404 + admin-dashboard
      client : 7 sections, recharts, force-scrape, feedback status, user search, screenshot)
      + types/méthodes admin dans lib/api.ts
- [x] 8 — typecheck 7/7 + build 7/7 + ch:setup + smoke CH/PG

## Décisions clés (détail findings.md § Patch-02)
- scrape-monitor non linéaire → 3 points in-run + onFailure (skip recent_snapshot guard).
- Tâche @outrival/ai reste PURE : le JOB logge ai_runs (try/catch → error ; null →
  parse_failed ; sinon success).
- Rebranchement cache `cached` (patch-09) NON fait : exigerait de changer la signature
  publique de withAiCache + colonne hors enum → déféré. Coût IA sur-compte les hits cache.
- Allowlist lue dans process.env (pas env.ts). Web re-check serveur (404) + API re-gate
  chaque route (defense in depth). Allowlist vide = personne ne passe.
- Seuils ops hardcodés (KISS), gardes d'échantillon min anti alert-fatigue.

## Blockers
- Aucun. Runtime E2E (403 allowlist, alerte Slack dégradée, screenshot, force-scrape) =
  manuel, creds + Trigger.dev requis.

---

# Patch 16 — Homepage scraping v2 (diff structuré + scroll + synthèse)

## Session du 2026-06-01

## Objectif
Pour les monitors **homepage uniquement** : parser le HTML en structure sémantique,
diff structuré (remplace le diff lexical), capture scroll progressif (lazy content),
synthèse narrative IA réservée aux changements severity >= "medium". Fallback gracieux
sur les snapshots pre-patch. Zéro régression sur pricing/jobs/blog/reviews.

## Divergences vérifiées vs spec patch (le patch suppose une archi qui diverge)
- **Pas de `render.ts`/`captureHomepage`.** La capture est dans `packages/scrapers/
  src/lib/crawler.ts::runCrawler` — crawler GÉNÉRIQUE partagé par toutes les sources
  Playwright. Le homepage.scraper appelle juste `scrapePage`. → le scroll doit être
  opt-in par source (option threadée `ScrapeOptions.progressiveScroll`), actif côté
  path Playwright direct seulement (ScrapingBee rend déjà le JS, pas de scroll).
- **Le diff n'est PAS lexical-sur-HTML-brut.** C'est déjà `computeTextDiff(
  extractContent(html), …)` (visible-content, extract-content.ts = WIP non commité).
  C'est CE path qui sert de fallback "lexical". Fallback déjà en place.
- **Screenshot = PNG, clé `.png`, partagé toutes sources.** JPEG q80 = optim stockage
  sans consommateur (le diff visuel est patch-17). → décision: défèrer (à confirmer).
- **classify = `packages/ai/src/tasks/classify.ts`** (`classifyChange(diffText, ctx)`
  → `Classification | null`). On AJOUTE `classifyStructuredChanges` (garde classifyChange
  pour le reste). humanChangeBefore/After vivent sur `signals` (générés par classify,
  persistés par generate-signal).
- **ai_runs.task = string libre** → `classify_structured` / `narrate_change` OK. Loggé
  par le JOB, la tâche @outrival/ai reste PURE.
- **Transport des StructuredChange[]**: les stocker sur la row `changes` (jsonb +
  `diffType="structured"`), payload trigger inchangé (`{changeId}`), idempotent.

## patch-16 = COMPLETE (2026-06-01)
typecheck 7/7 ✓ · build 7/7 ✓ · scrapers tests 79 pass (15 parser + 23 diff neufs) ✓ ·
db:push appliqué (snapshots.homepage_structure, changes.structured_diff, signals.narrative).
Runtime E2E (scrape sites réels, mesure +30-50% texte, ratio narratives, coût Groq) =
manuel (creds + Trigger.dev), cf. findings § Patch-16 Runtime TODO.

## Étapes (1 unité = typecheck/build vert)
- [x] 0 — env (3 vars dans .env.example) ; cheerio déjà présent — pas de commit
- [x] 1 — scroll progressif opt-in homepage (crawler.ts scrollThroughPage + ScrapeOptions
      .progressiveScroll + homepage.scraper ; path Playwright direct seulement)
- [x] 2 — parser pur `src/parsers/homepage-structure.ts` (marche DOM déterministe) + 15 tests
- [x] 3 — db: `snapshots.homepageStructure` + `changes.structuredDiff` jsonb (untyped, cast
      au call site pour garder @outrival/db leaf) + db:push
- [x] 4 — `src/diff/homepage-diff.ts` (pur) + renderStructuredChanges + 23 tests + subpaths
- [x] 5 — intégration scrape-monitor (homepage+2 structures → structuré ; sinon/fallback → lexical)
- [x] 6 — `classifyStructuredChanges` (70b, cache) + wiring classify-change.job (perChange→structuredDiff)
- [x] 7 — `narrateChange` + `shouldNarrate` (gated) + `signals.narrative` + wiring generate-signal (best-effort)
- [x] 8 — API signals (narrative liste+détail, breakdown détail) + UI signal-card + why-insight-panel
- [x] 9 — typecheck 7/7 + build 7/7 + tests 79 + db:push + findings/task_plan

## Décisions prises (2026-06-01)
- **Je code, tu commites** : AUCUN commit fait par Claude, typecheck/build vert par étape.
- **JPEG screenshot DÉFÉRÉ** : on garde PNG (étape 1 = scroll seul, pas de changement de
  format). Le diff visuel patch-17 décidera du format.

## Blockers
- WIP non commité déjà présent (patch-15 self-product, 10 fichiers + extract-content.ts
  non tracké mais load-bearing). À ne pas balayer.

---

# Patch 17 — Homepage enrichments (visuel, claims, social proof, score, garde-fous)

## Session du 2026-06-01

## Objectif
6 enrichissements TOUS additifs sur le pipeline homepage patch-16, zéro régression
patch-14/16 :
1. pHash (dHash 64-bit) sur le screenshot → détecte un redesign visuel raté par le diff texte.
2. Claims chiffrés ("15,000 teams", "99.9% uptime") extraits par regex + suivi ClickHouse.
3. Logos clients ajoutés/retirés (matching normalisé).
4. Score de pertinence composite → peut **SILENCER** un change faible (seuil conservateur 0.5).
5. Garde anti-vide basée sur la médiane des 5 derniers (complète, ne remplace pas, isContentCollapsed).
6. Apprentissage auto des lignes volatiles par monitor (table volatile_lines).
+ Étape UI : enrichir le why-insight-panel (claims / logos / redesign / score discret).

## Phase en cours
Post-MVP — Patch 17 (suite directe patch-16, prérequis COMPLETE).

## Divergences vérifiées vs spec patch (à adapter AVANT de coder)
1. **Monorepo : `@outrival/scrapers` = leaf (shared only).** Le patch met `db`/`snapshots`/
   `volatileLines` DANS scrapers (checkAntiVoid(…, db), updateVolatileTracking lit db) →
   viole monorepo.md. → tous les nouveaux modules scrapers restent **PURS** (phash,
   numeric-claims, social-proof diff, relevance, anti-void décision, volatile normalize/
   transition/filter). Tout l'I/O DB+ClickHouse est orchestré dans **scrape-monitor.job.ts**
   (qui importe déjà db) — comme `evaluateSignificance` (ai pur) / parsers (scrapers purs).
2. **Screenshot = PNG (clé `.png`), pas JPEG.** pHash calculé sur `result.screenshotBuffer`
   via sharp (format-agnostique), gardé `length > 0`. On NE change PAS le format (patch-16
   l'a déféré ; non bloquant pour le pHash). Si un scraper ne rend pas de screenshot → pHash skip.
3. **Détection redesign UNIQUEMENT dans le bloc structured-diff** (l.329-373 de scrape-monitor),
   donc seulement quand un change de contenu existe déjà (`distance > seuil && structuredChanges
   .length < 3`). Un redesign PUR (texte extrait identique) sort tôt l.206 (hash identique) →
   hors scope, conservateur. Noté comme limite.
4. **Anti-vide = ADDITIF.** L'existant `isContentCollapsed` (vide absolu → throw/retry) reste.
   On AJOUTE le garde médiane (chute < 30% médiane des 5 derniers `contentSize`). Déclenche
   un `throw` (retry Trigger, cohérent avec l'existant), pas un nouveau `retryLater`. Fallback
   gracieux si < 2 snapshots d'historique.
5. **Testimonials détaillés = IN (choix user), sans nouvelle table.** Hash stable par quote
   (`socialProof.testimonials[]` ajouté à HomepageStructure). Contrainte dure « carousel =
   jamais de signal » respectée par une **garde de stabilité ≥3 scrapes consécutifs dans
   LES DEUX SENS** : `testimonial_added` seulement si le hash est présent dans les 3 derniers
   scrapes consécutifs ; `testimonial_removed` seulement si absent des 3 derniers. Un carousel
   qui tourne ne stabilise jamais → 0 signal ; un wall statique stabilise → détecté. L'historique
   vient des `homepageStructure` des derniers snapshots (déjà stockés) → **pas de table dédiée**.
   Donc cette détection est **worker-orchestrée** (helper pur `diffTestimonialsStable(recentSets,
   current)` dans social-proof.ts), pas dans `diffHomepages` (2-arg). **Logos = full add/remove**
   dans diffHomepages (réutilise `customerLogos: string[]`, normalisé à la volée).
6. **Nouveaux ChangeKind + metadata.** `StructuredChange` (homepage-diff.ts) gagne les kinds
   `visual_redesign | numeric_claim_changed | customer_logo_added | customer_logo_removed`
   + un champ optionnel `metadata?: Record<string, unknown>`. classify-structured apprend 2
   règles (visual_redesign ≥ medium ; numeric_claim_changed major si variation forte) sans
   casser le reste. KIND_LABELS (why-insight-panel) étendu.
7. **Relevance SILENCE en amont de classify.** Scoré dans scrape-monitor après diffHomepages
   (+ changes enrichis poussés) ; si 0 change ≥ 0.5 → on stocke le snapshot baseline, **aucune
   row `changes`, aucun classify, loggé** (cohérent avec le path "no structural change").
   `previousChangesInLast7Days` = count `changes` (join monitors) du competitor sur 7j.
8. **numeric_claims = ClickHouse** (append-only, time-series). Ajout à `ensureClickhouseTables`
   + helper `insertNumericClaims`/`getLastNumericClaims` dans `apps/workers/src/lib/clickhouse.ts`
   (insertBestEffort existant). `volatile_lines` = **Postgres** (état mutable par monitor).
9. **UI** : `/signals/:id/detail` (signals.ts) expose déjà narrative + breakdown ; on AJOUTE
   claims/logos/redesign/relevanceScore (depuis `changes.structuredDiff` + signal). `SignalDetail`
   (api.ts) étendu. Sections modulaires (affichées seulement si présentes).

## patch-17 = COMPLETE (2026-06-01, commits laissés à l'utilisateur)
typecheck 7/7 ✓ · build 7/7 ✓ · scrapers 115 tests pass (13 fichiers) · db:push
(snapshots.screenshot_phash + content_size ; table volatile_lines) + ch:setup
(numeric_claims) appliqués. Détails findings.md § Patch 17. Runtime E2E = manuel.

## Étapes (1 unité = typecheck/build vert ; commits laissés à l'utilisateur)
- [x] 0 — env : 5 vars ENRICHMENTS_* (.env.example + .env.local) ; sharp@0.34.5 ajouté (scrapers)
- [x] 1 — pHash : `scrapers/lib/phash.ts` (pur, dHash+hamming, +test) + `snapshots.screenshotPhash`
      (text hex) + db:push + wire scrape-monitor (calcul best-effort à l'insert, redesign dans bloc structuré)
- [x] 2 — claims : `scrapers/parsers/numeric-claims.ts` (pur, +test) + CH `numeric_claims` + ch:setup +
      worker insert/query + détection variation > 20% → `numeric_claim_changed` (nouveau claim ne fire pas seul)
- [x] 3 — social proof : `diffLogos` (homepage-diff, normalisé, asset ignoré) + `socialProof.testimonials[]`
      (hash FNV) + `diffTestimonialsStable` pur (2 windows → carousel jamais, 6 snapshots requis) worker-orchestré
- [x] 4 — relevance : `scrapers/scoring/relevance.ts` (pur, magnitude = dissimilarité tokens, +test) +
      filtrage scrape-monitor (count 7j) ; seuil 0.5 → silence + log ; relevanceScore dans change.metadata
- [x] 5 — anti-vide : `scrapers/lib/anti-void.ts` (pur, médiane + plafond absolu 600, +test) +
      `snapshots.contentSize` + db:push + wire ADDITIF (à côté de isContentCollapsed, throw→retry)
- [x] 6 — volatile : `db/schema/volatile-lines.ts` + db:push + `scrapers/learning/volatile-detector.ts`
      (pur, +test) + wire scrape-monitor (upsert + filter bodyDiff + drop section_body_changed vidés)
- [x] 7 — UI : why-insight-panel (labels nouveaux kinds + variation % claims + score discret) +
      `/signals/:id/detail` (metadata + relevanceScore max) + SignalChange/SignalDetail types
- [x] 8 — typecheck 7/7 + build 7/7 + bun test scrapers 115 + db:push + ch:setup + findings + task_plan

## Commits suggérés (1 par étape, laissés à l'utilisateur)
- `feat(scrapers): perceptual hash for visual redesign detection`
- `feat(scrapers): extract and track numeric claims over time`
- `feat(scrapers): track customer logos and testimonials over time`
- `feat(scrapers): relevance score to filter low-impact changes`
- `feat(scrapers): anti-void guard based on historical median`
- `feat(scrapers): auto-learn volatile line patterns per monitor`
- `feat(web): display enrichments in why-insight panel`

## Décisions prises (confirmées 2026-06-01)
- **Je code, tu commites** : AUCUN commit/git add fait par Claude, typecheck/build vert par étape.
- **Testimonials détaillés IN** (logos + témoignages, garde ≥3 scrapes). Anti-vide ADDITIF.
  pHash redesign-only-on-change. Scrapers reste leaf (modules purs, I/O orchestré worker).

## Blockers patch-17
- Aucun connu. Test E2E runtime (scrape réel, distance pHash, claims CH, filtrage relevance) = manuel.

---

# Patch 18 — Détection du tech stack des concurrents

## Session du 2026-06-01

## Objectif
Scraper INDÉPENDANT (pas couplé à la homepage / scrape-monitor) qui détecte le
tech stack d'un concurrent (headers HTTP + scripts + DOM + footer + page
/integrations) à fréquence MENSUELLE. Catalogue non-exhaustif au départ, enrichi
par observation. État courant en Postgres, historique apparition/disparition en
ClickHouse. « Signal » généré uniquement pour les apparitions d'importance >= medium.
Aucune dépendance à un service tiers payant (pas de Wappalyzer API).

## Divergences spec ↔ code réel (vérifiées AVANT de planifier)
1. **`scrapePage` ne renvoie PAS headers ni scriptUrls** (crawler.ts : html/text/
   screenshot/statusCode/etag/lastModified). La spec suppose
   `scrapePage(url,{captureHeaders,captureScriptUrls})`. → Le scraper tech-stack
   fait un **`fetch()` natif** (headers gratuits + HTML), scriptUrls parsés via
   cheerio (`script[src]`). Pas de Playwright/Crawlee/ScrapingBee → vraiment
   indépendant + léger + zéro coût. Fail silencieux (non-2xx → skip).
2. **`signals.changeId` NOT NULL → FK `changes` → `changes.snapshotAfterId` NOT
   NULL → `snapshots`**. Impossible d'écrire dans le feed `signals` sans monitor +
   snapshot (R2) + change. La spec appelle `generateTechStackSignal(competitor,…)`
   directement — IMPOSSIBLE en l'état. → cf. **DÉCISION surfacing** ci-dessous.
3. **Pas de catégorie `tech_stack_change`** (categoryEnum = pricing|product|hiring|
   reviews|content|funding). **Pas de fréquence `monthly`** (frequencyEnum =
   realtime|daily|weekly).
4. **Scheduling indépendant** : ne PAS créer un monitor `tech_stack` (sinon
   `schedule-scraping` l'enverrait vers `scrape-monitor` = pipeline homepage).
   → cron dédié `schedule-tech-stack` + colonne `competitors.techStackScrapedAt`
   (null ou < now-30j → dû). batchTrigger `scrape-tech-stack`.
5. Précédents « signal-like hors table signals » DÉJÀ dans le code :
   `self_product_changes` + notif `self_change` (patch-12), `sectoral_signals`
   (patch-13). Le notif in-app est le canal établi pour ces events découplés.
6. Détecteur PUR (html+headers+scriptUrls) → testable bun sur fixtures réelles.
   Scraper fait l'I/O (pattern pricing : `analyzePricingHtml` pur + scraper I/O).
   Subpath export `@outrival/scrapers/tech-stack`.

## DÉCISION surfacing = OPTION B (validée par l'utilisateur 2026-06-01)
Feed `signals` complet. Le scraper/scheduling RESTE indépendant (fetch natif +
cron mensuel dédié + tables tech_stack propres) ; seule l'apparition importante
emprunte le pipeline existant pour produire un vrai signal :
- `source_type` enum += `tech_stack` (monitor d'ancrage `isActive=false` par
  competitor, JAMAIS ramassé par schedule-scraping ni getScraper).
- apparition importante (>= medium) → upload R2 du HTML fetché → 1 snapshot →
  1 `change` par tech (diffType "text", diffText = "New tech detected: …") →
  `generate-signal` avec une `Classification` synthétique (category "product",
  severity = high si importance high sinon medium). generateInsight produit
  l'insight stratégique (pas de nouveau prompt IA).
- Le monitor `tech_stack` est exclu des onglets-source de la fiche (Étape 5/6) :
  c'est de l'infra, pas une source user-facing. La section tech stack a sa propre UI.
- snapshot/change/R2 créés UNIQUEMENT s'il y a une apparition importante (pas à
  chaque scrape mensuel no-op). CH history "confirmed" NON écrit (lastDetectedAt PG
  suffit) — seulement appeared/disappeared, conforme spec step 6.

## Étapes (1 unité = typecheck/build vert ; commits laissés à l'utilisateur)
- [x] 0 — env : TECH_STACK_SCRAPE_INTERVAL_DAYS=30 + TECH_STACK_SIGNAL_MIN_IMPORTANCE=medium
      (.env.example + .env.local)
- [x] 1 — `scrapers/tech-stack/catalog.ts` : types + TECH_CATALOG (25 tech, 12 catégories)
- [x] 2 — `scrapers/tech-stack/detector.ts` (pur, cheerio footer lazy) + `scraper.ts`
      (fetch natif + extractScriptUrls résolution rel/protocol-rel) + `index.ts` +
      subpath `@outrival/scrapers/tech-stack` + 9 tests bun (Stripe script+footer,
      Vercel headers, Cloudflare cf-ray, Salesforce footer, Next.js dom, dedup)
- [x] 3 — schéma : `tech_stack_entries` (PG, uniqueIndex competitor+tech) +
      `competitors.techStackScrapedAt` + `source_type += tech_stack` (+ resync
      `SOURCE_TYPES` shared) + CH `tech_stack_history` ; db:push + ch:setup appliqués
- [x] 4 — workers : `scrape-tech-stack.job` (fetch→detect→merge /integrations→diff
      appeared/disappeared→upsert PG→CH history→techStackScrapedAt→emit signals
      important via monitor tech_stack isActive=false + snapshot R2 + change +
      generate-signal classif synthétique product) + cron `schedule-tech-stack`
      (daily, gate 30j, exclut self) + helper `insertTechStackHistory`
- [x] 5 — API : techStack dans GET /competitors/:id (entries actives + lastScrapedAt) ;
      monitor tech_stack exclu des onglets-source ; enable-monitor rejette tech_stack
- [x] 6 — UI : `competitor-tech-stack.tsx` (groupé par catégorie, FreshnessDot,
      « new · Xd ago » si <30j) après AiSummary + source-label "tech stack" + types api.ts
- [x] 7 — vérif : typecheck 7/7 ✓ · build 7/7 ✓ · scrapers 59 tests verts (9 tech-stack) ·
      db:push + ch:setup appliqués ✓ · findings.md + architecture.md + task_plan.md à jour

## patch-18 = COMPLETE (2026-06-01, commits laissés à l'utilisateur)
Détails findings.md § Patch 18. Test E2E runtime (cron mensuel, fetch réel, apparition
→ signal feed) = manuel (creds DB/R2/GROQ + Trigger.dev). Commits suggérés (1 par étape) :
- `feat(scrapers): tech stack catalog with detection patterns`
- `feat(scrapers): tech stack detector + native-fetch scraper`
- `feat(db): add tech stack tables (postgres + clickhouse)`
- `feat(workers): monthly tech stack scrape job with signal generation`
- `feat(api): include tech stack in competitor detail response`
- `feat(web): display tech stack on competitor profile page`

## Décisions périmètre (défauts, signalés)
- Scope = concurrents externes avec `url` non-null, `deletedAt` null. Self
  (`type="self"`) exclu pour cette passe (sa page a son propre traitement) — déféré.
- Catalogue volontairement partiel ; enrichi par observation (findings.md).

## Blockers patch-18
- Aucun (décision B prise). Limite connue : fetch natif bloqué par Cloudflare/anti-bot
  sur certains sites → détection dégradée ce mois-là (cf-ray header capté quand même).
  Pas de fallback Playwright/ScrapingBee (indépendance + zéro coût). À reconsidérer si
  taux d'échec élevé observé.

---

# Patch 19 — Refonte auth (magic link + Google + password fallback)

## Session du 2026-06-02

## Objectif
Refonte du flow d'auth : magic link primaire + Google OAuth secondaire + password
fallback, page UNIQUE /auth, anti-enumeration ABSOLUE, Turnstile + rate-limit + email
strict + HIBP. Rétrocompat : anciens comptes email+password fonctionnent.

## État des lieux (vérifié dans le code, pas supposé)
- Better Auth v1.6.11 mountée via `app.on(["POST","GET"], "/api/auth/*", ...)` dans
  apps/api/src/index.ts (ligne 45) → un endpoint custom sous /api/auth doit être
  enregistré AVANT ce wildcard sinon il est avalé.
- Auth config = apps/api/src/lib/auth.ts (pas de packages/auth). emailAndPassword only,
  hook user.create.after → miroir vers table `users` (app) depuis `user` (Better Auth).
- Org créée LAZY via ensureUserOrg() (pas au signup) → magic-link signup compatible.
- Upstash Redis présent (packages/shared/src/redis.ts → getRedis() null si pas de creds).
- PostHog branché : web `@/lib/posthog/events` (track/identifyUser, consent-gated),
  serveur apps/api/src/lib/posthog.ts.
- Erreurs patch-14 : apps/api/src/lib/errors.ts (errorBody(code,message,{userAction})).
- Resend : SDK dans apps/workers seulement (pas dans apps/api). Pattern email = HTML inline.
- Web auth actuel : groupe (auth) avec /login + /register séparés (pas /auth).
- Liens internes vers /login : dashboard/layout, onboarding (x2), user-menu, nav, robots ;
  vers /register : cta. (auth)/layout.tsx redirige déjà si session.

## Décisions (divergences assumées vs le doc patch — Karpathy/simplicity + règles repo)
1. Magic link : auto-signup NATIF Better Auth (signInMagicLink, disableSignUp défaut
   false → compte créé au verify). PAS le hack signUp({password:randomUUID}) du doc.
2. Email magic link : HTML inline dans l'API (comme digest-email), pas React Email.
   → add `resend` à apps/api, lib/magic-link-email.ts. Copy EN (language.md).
3. Endpoint custom monté AVANT le wildcard /api/auth/* (sinon avalé par Better Auth).
4. Google : authClient.signIn.social({provider:"google"}), pas un GET window.location.
5. HIBP/password util créé + testé ; password mode /auth = LOGIN only (rétrocompat).
   set-password depuis settings = follow-up (déjà déféré par le doc Étape 11.C).
6. TOUTE copy user-facing en ANGLAIS (language.md) — le doc patch était en FR.
7. Rate-limit dégrade en no-op si Upstash absent (getRedis() null) — dev safe.
8. Callback Google dérivé de BETTER_AUTH_URL (= API). dev :3001, prod api.outrival.io.

## Étapes
- [ ] 0 — env (.env.example) GOOGLE_*, TURNSTILE_*, AUTH_RATE_LIMIT_* + deps
- [ ] 1 — Better Auth config : magicLink + google + minPasswordLength 12 + session 30j
- [x] 2 — email magic link HTML inline (API, lib/magic-link-email.ts)
- [x] 3 — shared validation/email.ts (zod strict + disposable) + tests ✓
- [x] 4 — shared validation/password.ts (HIBP k-anon + schema) + tests ✓
- [x] 5 — middleware auth-rate-limit (email + IP, Upstash, anti-enum 429)
- [x] 6 — lib/turnstile.ts (verify, bypass dev si pas de secret)
- [x] 7 — route /api/auth/check-and-send-magic-link (anti-enum, monté avant wildcard)
- [x] 8 — page /auth unifiée (magic link > Google > password) + Turnstile invisible
- [x] 9 — suppression /login /register → redirects 308 + maj liens internes
- [x] 10 — events PostHog funnel (consent-gated) client + serveur
- [x] 11 — vérif typecheck (shared/ai/db/api/web ✓) + findings.md + architecture.md

## patch-19 = DÉVELOPPÉ (2026-06-02, commits laissés à l'utilisateur)
- typecheck mes packages ✓ ; scrapers/workers échouent = WIP patch-20 préexistant, hors scope.
- 11 tests verts (bun test src/validation/), HIBP live inclus.
- Setup manuel requis avant runtime (Google/Turnstile/Resend/Upstash) — cf findings.md.
- Commits suggérés (1/étape) = bloc <commit> du doc patch-19.

## Blockers patch-19
- Aucun côté code. Test runtime bloqué tant que le setup manuel (Google OAuth creds +
  Turnstile site + domaine auth@outrival.io Resend) n'est pas fait. Le code dégrade
  proprement sans (Turnstile bypass dev, magic link no-op, rate-limit no-op).

---

# Patch 20 — Refonte stack scraping (Patchright + ProxyScrape + Camoufox)

## Session du 2026-06-02 (planning)

## Objectif
Remplacer la cascade actuelle (Crawlee/Playwright direct-first → ScrapingBee) par une
cascade 5 niveaux découplée (fingerprint vs réputation IP) :
- L0 — `fetch()` HTTP direct, sans proxy (SSR/statique, ~0 coût)
- L1 — Patchright SANS proxy (IP serveur, sites JS non bloqués)
- L2 — Patchright + proxy DATACENTER ProxyScrape (~$10/mois, BP illimitée)
- L3 — Patchright + proxy RESIDENTIAL ProxyScrape (pay-per-GB)
- L4 — Camoufox + residential (dernier recours, fingerprint Chromium démasqué, rare)
Patchright = drop-in Playwright (stealth Chromium). ScrapingBee + Webshare SUPPRIMÉS.
`requiresProxy` (bool) → `requiresLevel` (0|1|2|3|4|null) + re-probe 14j.
scrape_runs tracke `level` + `failure_reason` (drop `used_proxy`/`used_scrapingbee`).

## État du code actuel (constaté 2026-06-02)
- Orchestrateur = `packages/scrapers/src/lib/crawler.ts` : `scrapePage` (direct Crawlee
  PlaywrightCrawler → fallback `scrapeViaScrapingBee`), `scrapeStatic` (CheerioCrawler),
  `scrapeFirstSuccess`. `looksBlocked()` heuristique. Pas de scrape-page.ts/proxy.ts/
  scrape-patchright.ts/fingerprint.ts. Pas de browser pool (patch-07 = conditional fetch).
- Call sites consommateurs (à préserver) : homepage / pricing (×3, preferProxy+proxyTier) /
  jobs / g2-reviews (preferProxy) / capterra-reviews (preferProxy) / blog (scrapeStatic).
  `quick-fetch.ts` (ScrapingBee fallback) + tech-stack/scraper.ts (fetch natif, indépendant).
- Webshare = ABSENT du code (seulement ScrapingBee). patch-23 / `diagnoseFailure` =
  ABSENTS (ni doc PHASES ni code) → routage par type d'échec fait inline.
- ScrapingBee référencé : quick-fetch.ts, scrapingbee.ts, crawler.ts, types.ts,
  tech-stack/scraper.ts, shared/constants/sources.ts, api/routes/admin.ts,
  workers/ops-health-check.job.ts, workers/scrape-monitor.job.ts, workers/env.ts,
  web/lib/scrape-errors.ts.
- ScraperResult actuel = { html, text, screenshotBuffer, metadata, statusCode, etag,
  lastModified } + ScrapeOutcome ajoute usedProxy. La nouvelle ScrapeResult du patch a
  une forme différente (ok/failureReason/level/...) → besoin adaptateur OU réécriture
  des scrapers source.

## DÉCISIONS À TRANCHER AVEC L'UTILISATEUR (avant code)
- D1 (MAJEURE) — Crawlee vs Patchright brut. Règle projet scraping.md = "TOUJOURS
  Crawlee, jamais Playwright/Puppeteer brut". Le patch dicte du `patchright` brut
  (chromium.launch direct, pool par tier, contexte manuel) → perd l'infra Crawlee
  (fingerprint injection, session pool, retry, concurrency/domaine), couverte en partie
  par le stealth Patchright. Option A = suivre le patch (brut, mettre à jour la règle).
  Option B = garder Crawlee avec launcher patchright (respecte la règle, plus d'intégration,
  risque double-stealth). Le patch est explicite pour A.
- D2 — Scope/séquencement sans creds + WSL. L2/L3/L4 non testables (pas de creds
  ProxyScrape) ; Camoufox binaire 300-500MB + WSL OOM → L4 difficilement testable local.
  Option A = tout coder L0-L4 (seuls L0/L1 vérifiés runtime, reste typecheck/build only).
  Option B = livrer L0/L1 + refonte structurelle (suppression ScrapingBee, migration
  requiresLevel, scrape_runs) maintenant ; L2-L4 derrière un suivi quand creds dispo.
- D3 — Migration DB `requiresProxy`→`requiresLevel` (PG) + colonnes scrape_runs (CH) :
  confirmer db:push / ch:setup dans cette branche (rename de colonne breaking).

## Décisions tranchées (2026-06-02)
- D1 = **Patchright brut** (suivre le patch, pas Crawlee) → règle scraping.md réécrite.
- D2 = **code complet L0→L4** (L2/L3/L4 non testés runtime sans creds ; L0/L1 + typecheck/build).
- D3 = migration DB OK (db:push + ch:setup laissés à l'utilisateur — voir Blockers).

## Étapes (DÉVELOPPÉ ; commits laissés à l'utilisateur)
- [x] 0 — env : PROXYSCRAPE_DC_*/RESI_* + CAMOUFOX_* + SCRAPING_LEVEL_*_ENABLED ajoutés
        (.env.example + workers/env.ts) ; SCRAPINGBEE_API_KEY retiré.
- [x] 1 — deps : +patchright +camoufox-js ; -crawlee -playwright (plus aucun import).
        `scrapingbee` n'était PAS une dep npm (fetch API) → rien à retirer.
- [x] 2 — `lib/fingerprint.ts` + `lib/proxy.ts` (ProxyTier direct|datacenter|residential).
- [x] 3 — `lib/scrape-patchright.ts` (ScrapeResult, pool par tier, capturePage partagée,
        isCloudflareChallenge exporté, /// <ref lib=dom>) + `lib/scrape-direct.ts` (L0).
- [x] 4 — `lib/scrape-camoufox.ts` (L4, residential, timeout 60s, types narrow → green).
- [x] 5 — `lib/scrape-page.ts` orchestrateur L0→L4 + lastFailureNeedsBrowserNotProxy
        (inline) + ESCALATING_FAILURES + skip niveau si proxy absent.
- [x] 6 — adaptateur `lib/crawler.ts` (mêmes exports → 0 churn d'import) ; scrapers source
        swap preferProxy→knownLevel ; g2/capterra plancher L2 ; appstore/github level:0 ;
        quick-fetch léger (no browser, garde le subpath API mince).
- [x] 7 — schéma monitors : requiresLevel + requiresLevelSince + requiresLevelLastReprobe
        + consecutiveFailures + markedUnscrapable (requiresProxy* supprimés).
- [x] 8 — scrape_runs (CH) : +level +attempts +failure_reason, DROP used_proxy/used_scrapingbee
        (CREATE + ALTER backfill) ; workers logScrapeRun + getScrapeHealth ; admin /cost
        + /scraping-health (level>=2 + breakdown l0..l4) ; web view (Cascade levels) ;
        ops-health-check alertes L2>25% / L3>5%.
- [x] 9 — re-probe 14j depuis L0 (pinned >=2) dans scrape-monitor + reconcile requiresLevel.
- [x] 10 — ScrapingBee/Webshare : grep code = 0 réf fonctionnelle ; scrapingbee.ts supprimé ;
        env/ops/admin/scrape-errors nettoyés ; copy landing (faq/json-ld/sources) corrigée.
- [x] 11 — UX unscrapable : 3 échecs consécutifs → markedUnscrapable (onFailure) ; exposé /admin.
        NOTE: message UI user-facing fiche competitor = TODO (voir Blockers).
- [x] 12 — vérif : typecheck 7/7 ✓ · scrapers 124 tests ✓ · grep scrapingbee/webshare code = 0 ·
        scraping.md + architecture.md + scrapers/CLAUDE.md à jour. (Build web = `tsc` ; next
        build a un bug rootDir préexistant hors-scope.)

## patch-20 = DÉVELOPPÉ (2026-06-02, commits laissés à l'utilisateur)

## Blockers / restant patch-20
- **db:push** : rename requires_proxy→requires_level = prompt interactif drizzle-kit
  (non supporté ici) + mutation DB live → LAISSÉ à l'utilisateur. Pas de data-migration
  nécessaire (monitors pinned re-apprennent leur niveau ; cascade auto-corrige).
- **ch:setup** (`pnpm --filter @outrival/db ch:setup`) : ajoute level/attempts/failure_reason
  + DROP used_proxy → mutation ClickHouse live, LAISSÉ à l'utilisateur (idempotent).
- **Prérequis manuels** : souscrire ProxyScrape (DC + residential), remplir les env,
  `npx patchright install chromium` (worker), `npx camoufox-js fetch` (~300-500MB, VPS 1Go).
  Sans creds : L0/L1 seuls actifs (cascade s'arrête → markedUnscrapable sur sites durs).
- **L2/L3/L4 non testés runtime** (pas de creds). Camoufox = types narrowés (path non vérifié).
- **TODO UI** : message "temporarily unavailable" sur la fiche competitor quand
  markedUnscrapable — flag posé en DB + /admin, pas encore rendu côté user.

---

# Patch 21 — Feedback loop qualité IA (session 2026-06-02)

## Objectif
Vrai feedback loop sur les sorties IA (signals, discovery, battle cards, digest,
severity, NPS) en 3 couches : capture inline 1-clic, action immédiate visible,
action systémique (dashboard ops + Slack sur patterns). PAS d'auto-ajustement IA.

## Décisions tranchées (avec l'utilisateur)
- Branche : **patch-02-admin-ops** (courante, on continue dessus).
- Feedback email digest : **inclus** via token HMAC signé court (route publique).

## Divergences carte Notion ↔ code réel (vérifiées avant code)
- session : `c.get("user").id` + `ensureUserOrg(user.id)` (PAS `session.userId/orgId`).
- PostHog serveur : `captureServerEvent()` de `lib/posthog` (PAS `posthogServer`).
- toasts : `sonner` `toast()` (PAS `showToast`).
- discovery : table réelle = `competitor_candidates` (statut new|dismissed|added) →
  action = `status="dismissed"` (PAS table `discoverySuggestions`).
- battle_cards : pas de colonne `status` → on ajoute juste `flaggedForRegenerationAt`.
- admin : route group `(admin)/admin/feedback-quality/page.tsx`.
- NPS : pas de table dédiée → `max(createdAt)` sur quality_feedback targetType='nps'.

## Étapes (commit après chaque) — TOUTES FAITES
- [x] 1 — schema quality_feedback.ts + 3 enums + index.ts (db:push DIFFÉRÉ, tree sale)
- [x] 2 — API routes/feedback-quality.ts (POST upsert / GET / DELETE / nps-status) + triggerImmediateAction (org-scopé) + revert au DELETE
- [x] 3 — signals (hiddenForUserAt/severityOverride/severityOverriddenBy) + battle_cards (flaggedForRegenerationAt) ;
        competitor_candidates réutilise status=dismissed ; feed signals filtre hidden + override + preload verdict
- [x] 4 — FeedbackButtons + reason selector (sonner) + cancel par re-clic
- [x] 5 — 6 points : signal-card (a) + severity (e) ; discovery via Track/Dismiss (b) ;
        battle-card-tab (c) ; digest email + token HMAC (d) ; NpsPrompt modal 1×/30j (f)
- [x] 6 — page (admin)/admin/feedback-quality + API admin stats/patterns + nav
- [x] 7 — job feedback-pattern-detection (cron lundi 9h UTC) → Slack
- [x] 8 — doc docs/feedback-loop.md + env .env.example (FEEDBACK_NPS_INTERVAL_DAYS / FEEDBACK_AGGREGATE_MIN_COUNT)
- [x] 9 — pnpm build + typecheck 7/7 verts (next build non lancé : WSL OOM). Notion → Done.

## Blockers patch-21
- db:push DIFFÉRÉ : le tree porte du WIP patch-20 destructif (monitors requires_proxy→requires_level).
  quality_feedback + colonnes signals/battle_cards sont ADDITIVES → à pusher quand le tree sera propre.
  Code + typecheck OK → patch considéré développé.

---

# Patch 22 — Résilience IA (pool de providers + rate limit intelligent) — session 2026-06-02

## Objectif
Résilience complète de la stack IA. **Source = pool de PROVIDERS légaux OpenAI-compatibles**
(Cerebras free prio1, Groq prio2, Hyperbolic payant prio3) via env `AI_PROVIDER_N_*`,
PAS de multi-comptes Groq (viole ToS). Moteur identique au prompt : rotation free→payant +
tracking quota tokens (Redis) + circuit breaker par provider & global + graceful degradation
+ rate limiting INTELLIGENT (staleness) + rate limit DUR (10 actions IA/h/user). 1 commit/étape.

## Décisions tranchées (avec l'utilisateur)
- "On fait ce que le prompt dit, se coller au max" → on suit le pivot option-A (providers),
  on code le moteur tel quel, on adapte SEULEMENT aux contraintes du vrai code.
- Branche : patch-02-admin-ops (courante).
- COMMITS (2026-06-02) : PAS de commit manuel (tree sale ~50 fichiers WIP patch-02/auth ;
  auto-committer concurrent). On code + typecheck par étape, on signale le vert ; l'historique
  est géré hors-Claude. Les "Commit:" ci-dessous = libellés indicatifs, NON exécutés.

## Avancement
- [x] 0 — env .env.example (AI_PROVIDER_1..3, breaker, intensive rate limit). Typecheck OK.
- [x] 1 — provider-pool.ts (loadProviders back-compat GROQ_API_KEY / pickProvider / trackUsage /
      tripBreaker) + export `redis` sûr (no-op si Upstash absent) dans @outrival/shared. shared+ai typecheck OK.
- [x] 2 — circuit-breaker.ts (global, Slack ops via sendSlackMessage) + provider-context.ts (ALS) +
      provider.ts rewrite (callLLM pool openai-SDK, failover borné 429/5xx, Claude conservé) +
      env.ts simplifié (GROQ_API_KEY plus requis) + index exports + logAiRun tagge provider réel.
      groq-sdk retiré (orphelin). shared+ai+workers typecheck OK.
- [x] 3 — GET /api/system/ai-status étendu (status healthy|degraded|down + estimatedRecovery via
      breaker) + type web + banner (copy "down" + recovery time) + digest job: guard breaker → throw,
      retry spread ~1h. api+web+workers typecheck OK.
- [x] 4 — Schema : battle_cards +basedOnUserUpdateAt/+basedOnCompetitorSignalAt + helper pur
      selfProfileLastEditedAt ; nouvelle table discovery_runs. db typecheck OK. db:push = USER (cf blockers).
- [x] 5 — Battle card staleness : GET /competitors/:id/battle-card/staleness (userChanged via
      selfProfileLastEditedAt, competitorChanged via dernier signal, +flaggedForRegenerationAt patch-21) +
      job battle-card pose basedOn* à la génération (clear flag). api+workers typecheck OK.
- [x] 6 — UI battle card : staleness fetch + bouton "Regenerate · up to date" (grisé+tooltip) vs
      "Regenerate" (amber/primary) + confirm inline force. Intégré dans battle-card-tab (pas de composant
      séparé = plus surgical). web typecheck OK.
- [x] 7 — Re-scrape staleness : GET /monitors/:id/staleness (lastRunAt+lastChangedAt) + UI friction
      via toast "Re-scan anyway" (requestRunMonitor wrappe les 6 onRun user ; enable/switch/run-all
      inchangés). DÉVIATION carte : toast confirm au lieu de bouton grisé (page 700+ lignes). web+api OK.
- [x] 8 — Discovery staleness : GET /candidates/staleness (daysSince<7 + selfProfile changé) + upsert
      discovery_runs sur /detect réussi + UI friction toast "Search anyway" sur la page candidates. OK.
- [x] 9 — Rate limit DUR : middleware ai-intensive-rate-limit.ts (getRedis no-op, errorBody 3-parties EN,
      AI_INTENSIVE_RATE_LIMIT/WINDOW) appliqué sur battle-card/generate, candidates/detect,
      my-product/rescan, onboarding/analyze-url. Lecture jamais gatée. api typecheck OK.
- [x] 10 — Dashboard ops : ÉTENDU /admin/ai existant (pas de page ai-health en double) — endpoint
      /api/admin/ai-health + providers (quota tokens Redis, %, breaker), globalBreaker, prédiction
      saturation ; vue admin/ai/view.tsx (section Providers + banner breaker). api+web typecheck OK.
- [x] 11 — apps/workers/src/jobs/ai-capacity-check.job.ts cron */30 (auto-discover dirs) : usage global %
      paliers 80/90 + épuisés → Slack ops, max 1 ping/2h. workers typecheck OK.
- [x] 12 — Vérif finale : pnpm typecheck 7/7 ✓ · next build web ✓ Compiled (erreur validator.ts rootDir
      = pré-existante, non liée) · bun test ai 18/18 ✓. Cohérence patch-02/09/12/14 OK. Strings EN.
      RESTE : db:push (USER) + clés providers/Upstash réelles (USER) + Notion Done.

## Divergences carte Notion ↔ code réel (vérifiées avant code) — cf. findings.md
- `@outrival/shared` exporte `getRedis(): Redis|null` (no-op si pas de creds), pas `redis`.
  → ajouter un export `redis` (proxy lazy sûr) pour coller au `import { redis }` de la carte.
- Provider actuel = `packages/ai/src/provider.ts` (pool multi-CLÉS Groq, groq-sdk, cooldown
  in-memory) + fallback Claude. `complete(config, options)` = entrée unique de tous les prompts.
  → le pool s'intègre DANS `complete()` (branche provider="groq" → callLLM pool). Callers inchangés.
- Nouvelle dép `openai` dans @outrival/ai (Cerebras/Groq/Hyperbolic OpenAI-compatibles).
- AiStatusBanner + `GET /api/system/ai-status` EXISTENT (patch-02) → on ÉTEND (breaker → degraded/down
  + estimatedRecovery), on ne crée PAS `/api/health/ai`.
- `signals` n'a PAS de `monitorId` (lien via change_id). monitor staleness via `monitors.lastChangedAt`
  vs `lastRunAt` (déjà trackés) au lieu de `eq(signals.monitorId, …)`.
- `monitor.lastScrapedAt` → vrai champ = `lastRunAt`.
- `lastEditedByUserAt` = imbriqué par-champ dans `selfProfile` jsonb (SelfProfileField), PAS colonne
  → dériver le max sur les champs du profil self.
- battle_cards a `generatedAt` + `flaggedForRegenerationAt` ; AJOUTER basedOnUserUpdateAt +
  basedOnCompetitorSignalAt (db:push).
- Discovery on-demand = `candidatesRouter.post("/detect")` ; pas de table run → créer discovery_runs.
- Admin web = route group `(admin)/admin/…` → `(admin)/admin/ai-health` (renommé groq→ai = providers).
- Slack = `sendSlackMessage(OPS_SLACK_WEBHOOK_URL, …)` ; @outrival/ai reste pur (helper minimal/guard).
- Session API = `c.get("user")` + `ensureUserOrg(user.id)` (pas session.userId/orgId).
- ai_runs.provider reçoit le "groq" statique d'AI_CONFIG → propager le VRAI provider du pool
  (AsyncLocalStorage lu par loggedAi/logAiRun, callers inchangés).

## Étapes (commit après chaque)
- [ ] 0 — Env : AI_PROVIDER_1..N_* (Cerebras/Groq/Hyperbolic) + AI_CIRCUIT_BREAKER_* +
        AI_INTENSIVE_RATE_LIMIT/WINDOW dans .env.example. Pas de commit isolé (→ étape 1).
- [ ] 1 — `packages/ai/src/provider/provider-pool.ts` : Provider iface + loadProviders() +
        pickProvider() (free→payant, skip épuisés/breaker, round-robin même priorité) +
        trackUsage(tokens) + tripBreaker. Export `redis` sûr dans @outrival/shared.
        Commit: feat(ai): provider pool with redis quota tracking and rotation
- [ ] 2 — `circuit-breaker.ts` (global) : checkGlobalBreaker / recordFailure / recordSuccess /
        tripGlobalBreaker (+ Slack ops guard). `callLLM` (openai SDK, route baseUrl) intégré
        dans `complete()` (provider="groq"). Propagation provider → ai_runs.
        Commit: feat(ai): global circuit breaker + provider-routed callLLM
- [ ] 3 — Graceful degradation : `GET /api/system/ai-status` étendu (healthy|degraded|down +
        estimatedRecovery depuis breaker) ; banner existant branché. Digest cron retry +1h si breaker.
        Commit: feat(web): graceful degradation banner when ai is down
- [ ] 4 — Schéma : battle_cards +basedOnUserUpdateAt/basedOnCompetitorSignalAt ;
        nouvelle table discovery_runs (orgId, lastDiscoveryAt, basedOnProfileUpdateAt). db:push.
        Commit: feat(db): change-tracking fields for intelligent rate limiting
- [ ] 5 — Battle card staleness : GET `/competitors/:id/battle-card/staleness` (userChanged via
        max selfProfile edits, competitorChanged via dernier signal competitor). Set based* à la génération.
        Commit: feat(api): battle card staleness detection
- [ ] 6 — UI bouton "already up to date" (grisé+tooltip) vs "Regenerate" (amber) + confirm inline force.
        Commit: feat(web): smart regenerate button with staleness indicator
- [ ] 7 — Re-scrape manuel staleness : GET staleness via monitor.lastRunAt + lastChangedAt
        (very_recent <30min / fresh <24h sans change / outdated). UI même pattern.
        Commit: feat(api+web): smart manual rescrape with staleness
- [ ] 8 — Discovery staleness : GET `/candidates/staleness` (daysSince + profil self changé) +
        track discovery_runs sur /detect. UI bouton + lien profil produit.
        Commit: feat(api+web): smart discovery with profile-based staleness
- [ ] 9 — Rate limit DUR : middleware `ai-intensive-rate-limit.ts` (redis incr/expire, 429 message
        3-parties EN). Appliqué : battle-card generate, candidates/detect, my-product/rescan,
        onboarding analyze-url. Lecture jamais limitée.
        Commit: feat(api): hard rate limiting for ai-intensive actions per user
- [ ] 10 — Dashboard ops `(admin)/admin/ai-health` + `GET /api/admin/ai-health` : par provider
        (quota tokens/j, %, breaker), breaker global, usage 7j (ai_runs CH), top actions, prédiction saturation.
        Commit: feat(admin): ai providers health dashboard with prediction
- [ ] 11 — `apps/workers/src/jobs/ai-capacity-check.job.ts` cron */30 : usage global % par paliers
        (80/90 + épuisés) → Slack ops, max 1 ping/2h.
        Commit: feat(workers): ai capacity monitoring with paced slack alerts
- [ ] 12 — Vérif finale : pnpm build + typecheck (7/7). Cohérence patch-02 (ai_runs provider),
        patch-09 (cache hit → skip pool), patch-12 (selfProfile edits), patch-14 (messages 3-parties EN).
        Strings EN (language.md). MAJ findings.md + Notion Done. Commit: docs.

## Blockers patch-22
- Upstash réel requis pour que le moteur soit effectif (quota/breaker/round-robin). Sans creds:
  no-op → dégrade vers "1er provider, pas de tracking". Provisioning = utilisateur.
- Clés Cerebras/Hyperbolic réelles = utilisateur (le code charge ce qui est configuré en env).
- db:push (battle_cards + discovery_runs) = mutation DB live → utilisateur si prompt interactif.

---

# Patch 23 — Edge cases scraping (diagnostic + alternatives + pivot + API capture)

## Session du 2026-06-02

## Objectif
Quatre couches pour les cas où patch-20 (cascade anti-bot) ne suffit pas, au lieu
de juste marquer `markedUnscrapable` :
1. Diagnostic fin des échecs (7 catégories).
2. Alternatives proposées à l'user (URL publique / saisie manuelle / pause).
3. Détection pivot/mort/rachat = signal structurel + vérification IA (anti faux positif A/B).
4. Capture d'API runtime pour SPA pures (opt-in monitor + auto-activation).
**Tout user-facing + AI-facing en ANGLAIS** (language.md override les strings FR du patch).
Login requis = HORS SCOPE (juste alternatives, pas de scraping connecté). Geo-block = documenté.

## Phase en cours
Post-MVP — Patch 23 (s'appuie sur patch-20 cascade, patch-17 pHash, patch-14 messages 3-parties).

## Divergences réelles vs spec Notion (à acter AVANT de coder)
1. **`diagnoseFailure` n'a pas accès au `CascadeOutcome` complet dans `onFailure`.**
   `scrape-monitor.job.ts onFailure({error})` ne reçoit que le message d'erreur ; l'adaptateur
   `lib/crawler.ts > scrapePage` throw `failureReason` et JETTE déjà `attempts`/`finalUrl`/`statusCode`.
   `ScrapeOutcome` (types.ts) n'expose que `level` + `attempts:number` (compte), pas le tableau.
   → Le diagnostic doit tourner **dans le body du run, là où on a encore le CascadeOutcome riche**
   (avant le throw final), pas dans `onFailure`. Soit l'adaptateur remonte un échec structuré
   (`{ok:false, attempts, finalUrl, statusCode, failureReason}`) au lieu de throw, soit on appelle
   `diagnoseFailure` dans le catch du body. Décision = remonter un résultat structuré.
2. **Les snapshots ne stockent PAS le `text` en Postgres** (seulement `r2Key`, `contentHash`,
   `contentSize`, `screenshotPhash`). La spec pivot lit `snapshot.text` → faux. Le texte vit
   dans le HTML sur R2. → `detectStructuralChange` doit **fetch les N derniers HTML depuis R2 +
   extractContent** pour le textDiff. `screenshotPhash` (hex) lui EST stocké → phash diff direct.
   Règle archi : JAMAIS de HTML/texte en PG → on ne rajoute pas de colonne `text`.
3. **Les competitors externes n'ont pas de `productProfile`.** Ils ont `category`, `description`,
   `aiSummary` (org.productProfile = self uniquement). → `verifyContentMatchesProfile` consomme
   `competitor.{name,category,description,aiSummary}`, pas `productProfile`.
4. **AI : provider abstrait + `ai_runs` logging (patch-02).** `verify_content_profile` passe par
   le provider `@outrival/ai` et se logge via le wrapper `loggedAi`/équivalent (task tag).
   PAS de cache (contexte-dépendant). Le hard rate-limit IA est patch-22 (planifié, non implémenté)
   → on se contente du logging `ai_runs` existant ; pas de dépendance bloquante.
5. **Admin = route group `(admin)/admin/`** (pas `app/admin/`). Sous-pages existantes :
   ai/audit/cost/feedback/feedback-quality/jobs/scraping/users. → page edge-cases sous
   `(admin)/admin/scraping-edge-cases/` (cohérent), data via `GET /api/admin/*`.
6. **FailureReason réel** = `blocked_403|blocked_503|cloudflare_challenge|soft_block|needs_render|
   network_error|timeout`. Pas de `404/410` dans failureReason (un 404 sort en `statusCode` sur un
   résultat `ok:false` ou via needs_render selon le niveau). → diagnostic lit `statusCode` ET
   `failureReason`. Vérifier que L0/scrapeDirect remonte bien le `statusCode` 404/410/30x + `finalUrl`.
7. **3 nouvelles tables** (monitor_alternatives, structural_changes, manual_snapshots) +
   colonnes monitors (lastFailure*, apiCaptureEnabled, apiCaptureEndpoints). db:push = live.
   ⚠️ MEMORY : patch-21 a déjà du schéma non-pushé + tree sale → vérifier l'état db:push avant.

## Étapes (1 commit par étape — laissés à l'utilisateur si tree sale au démarrage)
- [ ] 0 — env (.env.example + .env.local) : PIVOT_DETECTION_MIN_SCRAPES,
      PIVOT_DETECTION_TEXT_DIFF_THRESHOLD, PIVOT_DETECTION_PHASH_DISTANCE,
      SPA_DETECTION_HTML_MIN_TEXT_LENGTH, SPA_API_CAPTURE_TIMEOUT_MS. Pas de dép. Pas de commit.
- [ ] 1 — `packages/scrapers/src/lib/diagnose-failure.ts` (pur, <100ms) : FailureCategory(7) +
      DiagnosisResult + diagnoseFailure(cascadeOutcome, monitorUrl, recentSnapshots) + helpers
      detectsLoginPage/detectsGeoBlock/sameRootDomain. Adaptateur crawler.ts remonte un échec
      structuré (cf. divergence 1). Schéma monitors += lastFailure{Category,Confidence,Evidence,
      DiagnosedAt}. Branché dans scrape-monitor body. db:push.
      Commit: feat(scrapers): fine-grained failure diagnosis
- [ ] 2 — Schéma : monitor-alternatives.ts (+enums status/type) + structural-changes.ts
      (+enums type/status) + index.ts. db:push.
      Commit: feat(db): add monitor alternatives and structural changes tables
- [ ] 3 — `packages/scrapers/src/alternatives/generate.ts` : generateAlternatives(monitor,diagnosis)
      → toujours manual_data_entry + pause_source ; login→findPublicAlternatives (blog/changelog/
      docs/about, isQuicklyReachable via quick-fetch existant) ; site_dead/redirected→replace_competitor.
      Appelé quand markedUnscrapable passe à true → insert monitor_alternatives. Strings EN.
      Commit: feat(scrapers): generate alternatives for unscrapable monitors
- [ ] 4 — `packages/scrapers/src/structural/detect-pivot.ts` (fetch 3 derniers HTML R2 + extractContent
      + hammingDistance phash, anti-A/B via diff milieu<0.3) + `packages/ai/.../verify-content-profile.ts`
      (prompt EN, "Write all text in English", smart 70b, no cache, tag ai_runs) +
      `apps/workers/src/jobs/detect-structural-changes.job.ts` (cron hebdo, ≥3 snapshots).
      Insert structural_changes status=detected. Strings EN.
      Commit: feat(scrapers+ai): detect pivot/death/acquisition with structural + ai verification
- [ ] 5 — `packages/scrapers/src/spa/api-capture.ts` : scrapeWithApiCapture(page,url) (listener
      response xhr/fetch json) + filterRelevantApiCalls. Schéma monitors += apiCaptureEnabled +
      apiCaptureEndpoints. Auto-activation sur diagnosis spa_empty (découverte 1 fois → si appels
      pertinents, enable + stocke endpoints, sinon unscrapable). Intégré dans le flow Patchright.
      Commit: feat(scrapers): capture api calls at runtime for spa-pure sites
- [ ] 6 — UI `apps/web/src/components/outrival/monitor-alternatives.tsx` (messages 3-parties EN,
      design sobre) + `POST /api/monitor-alternatives/:id/accept` (different_url→nouveau monitor +
      archive ancien ; manual→form ; pause→isActive=false). Branché sur l'état unscrapable patch-20.
      Commit: feat(web): display monitor alternatives with clear actions
- [ ] 7 — Saisie manuelle : schéma manual-snapshots.ts + UI manual-data-entry.tsx (champs par
      sourceType : pricing/features/jobs/reviews) + route POST. Tag "manual" (FreshnessDot "entered
      manually on X"). db:push. Strings EN.
      Commit: feat(web): manual data entry for unscrapable sources
- [ ] 8 — Notifications structural change : in-app (notification_type += structural_change?) +
      banner feed + email Resend EN (max 1/competitor/mois) + endpoints GET /api/structural-changes?
      status=detected + POST /:id/resolve (confirmed_paused|replaced_with:id|false_positive|
      confirmed_continue). Résolution user obligatoire.
      Commit: feat(web+api): structural change notifications in-app and email
- [ ] 9 — `(admin)/admin/scraping-edge-cases/page.tsx` + `GET /api/admin/*` : échecs par catégorie
      (7j, scrape_runs/monitors), alternatives proposées/acceptées, structural changes, capture API.
      Commit: feat(admin): scraping edge cases dashboard
- [ ] 10 — Vérif : pnpm build + typecheck (7/7). Tests E2E A–F de la spec (manuels, creds).
      Cohérence patch-14/17/20/22. Strings EN. MAJ findings.md + task_plan.md + Notion Done.

## Décisions à confirmer avec l'utilisateur (avant Étape 1)
- D1 (intégration diagnostic) : remonter un échec structuré depuis l'adaptateur `crawler.ts`
  (au lieu de throw) pour avoir attempts/finalUrl/statusCode dans le body. ✔ recommandé.
- D2 (texte pivot) : fetch les 3 derniers HTML depuis R2 + extractContent pour le textDiff
  (PAS de colonne text en PG). ✔ recommandé (respecte l'archi R2).
- D3 (profil verify) : competitor.{name,category,description,aiSummary} (external) ;
  org.productProfile pour le self. ✔.
- D4 (périmètre) : implémenter les 10 étapes d'un coup, ou par lots (1-2 scrapers, 3-5 pivot/spa,
  6-9 web/admin) avec validation entre lots ?

## patch-23 = COMPLETE (implémenté 2026-06-02, commits + db:push laissés à l'utilisateur)
Typecheck 6/6 non-web verts + web 0 erreur src (seul l'artefact stale `.next/types/validator.ts`
rootDir subsiste, pré-existant). 149 tests bun verts (27 nouveaux : diagnose-failure 10,
detect-pivot 9, spa filter 8). `next build` NON lancé (risque OOM WSL ; standard client components).

Décisions d'implémentation actées (vs spec) :
- D1 : `ScrapeFailedError` (crawler.ts) porte le `CascadeOutcome` → diagnostic dans le body
  catch (même invocation). Les shells login/SPA vides tombent déjà en échec via les gardes
  collapse/anti-void → diagnostic failure-path only (pas sur chaque succès). 404 lu via
  `attempts[].statusCode` (scrapeDirect ne fait pas échouer sur 404 mais porte le status).
- D2 : pivot textDiff = Jaccard de mots (pur), pas computeTextDiff (qui renvoie added/removed).
  Textes des 3 derniers snapshots fetchés depuis R2 + extractContent. phash optionnel si absent.
- D3 : verify-content-profile consomme competitor.{name,category,description,aiSummary}.
- SPA reuse : capture → document HTML synthétique (comme github_repo) → pipeline générique
  inchangé. Récupération sur transition unscrapable (spa_empty) : enable + reset failure state
  → pas de boucle (le prochain run via capture produit du contenu).
- "different_url" : repointe le monitor existant (invariant 1/(competitor,source)) au lieu de
  dupliquer/archiver.
- Notif structural change (in-app + email throttlé 1/mois) faite dans la lib worker (Étape 4+8
  fusionnées côté détection) ; API endpoints + UI banner = Étape 8.

## Blockers patch-23
- db:push (4 tables : monitor_alternatives, structural_changes, manual_snapshots + colonnes
  monitors lastFailure*/apiCapture* + enum notification_type += structural_change + 3 enums)
  = mutation DB live. NON poussé (MEMORY patch-21 schéma déjà non-pushé + tree sale). À faire
  à la main avant runtime.
- patch-22 (hard rate-limit IA) non implémenté → verify_content_profile loggé via loggedAi
  (ai_runs) seulement, pas de quota dur.
- Tests E2E (SPA réelle, pivot forcé, email) = runtime, creds GROQ/R2/DB/Resend/Trigger.dev = manuel.
- `next build` web non lancé (OOM WSL) → vérif bundle client/serveur à faire si besoin.

---

# Patch-24 — Anti-hallucinations IA (grounding + self-check + transparence)

## Objectif
5 couches de défense contre les hallucinations IA. Le grounding INFORME, ne bloque pas.
Contenu flagged reste affiché (transparence).

## Décisions (validées par l'utilisateur)
- **ai_runs reste ClickHouse** (append-only). Nouvelle table **Postgres `ai_quality_checks`**
  pour l'état mutable (grounding/self-check/review humaine), lookup par (target_type, target_id).
  ai_runs CH reçoit en plus 2-3 colonnes append-only (confidence, self_check_passed, grounding_score)
  pour les métriques agrégées.
- **XL complet, 1 commit par étape.** **12 surfaces migrées d'un coup.**
- `@outrival/ai` reste **pure** : `groundedAiCall` (pur) renvoie le résultat enrichi ;
  la **persistance** ai_quality_checks se fait côté appelant (jobs workers + routes API).
  → diverge de la carte qui mettait logAiRun+db.update DANS le wrapper (impossible : tasks pures).

## Mapping des 12 "tasks" carte → code réel
1 classify_change → tasks/classify.ts + classify-structured.ts
2 generate_signal → job generate-signal.job.ts via tasks/insight.ts
3 score_overlap → tasks/score-overlap.ts
4 generate_battle_card → tasks/battle-card.ts
5 analyze_product → tasks/analyze-product.ts
6 summarize_competitor → tasks/competitor-summary.ts
7 detect_pricing_strategy → tasks/pricing-repositioning.ts
8 extract_features → tasks/extract-self-profile.ts
9 classify_severity → inclus dans classify/classify-structured
10 verify_content_profile → tasks/verify-content-profile.ts (patch-23)
11 generate_digest → tasks/digest.ts
12 detect_sector_signals → sectoral/formulate.ts (patch-13)

## Étapes (1 commit chacune) — TOUTES COMPLÈTES
[x] 0 — Env vars (.env.example)
[x] 1 — Schéma : table PG ai_quality_checks + colonnes CH ai_runs — db:push OK
[x] 2 — citations.ts (validateCitations fuzzy substring 0.85) + test 8/8
[x] 3 — Wrapper groundedAiCall (pur, enveloppe + fallback schéma nu)
[x] 4 — Migré les 12 tasks → groundedAiCall (_quality non-enumerable, 0 régression)
[x] 5 — Self-check + persist (signal/battle_card/digest/overlap_scoring)
[x] 6 — ConfidenceDot + join signals API + SignalCard
[x] 7 — AiOutputWarning + endpoint user acknowledge + SignalCard
[x] 8 — Admin review queue (/admin/ai-review-queue + GET/POST API + helpers db)
[x] 9 — Section AI Quality (/admin/ai) + alerte Slack >3%/7j (ops-health-check)
[x] 10 — Vérif : 6 pkgs typecheck clean, web src clean, next build compile OK, tests 8/8

## Notes finales
- next build : seule erreur = .next/types/validator.ts (rootDir:src vs include .next/types) —
  conflit Next16 PRÉ-EXISTANT, hors scope patch-24 (non corrigé, règle surgical).
- ⚠️ Commit Étape 1 a balayé l'arbre non-commité des patches 16-23 (git add -A, règle git.md).
  Arbre propre depuis ; commits 2-9 correctement scopés.
- Persist limité à signal/battle_card/digest/overlap_scoring (surfaces UI/entité). Les autres
  tasks routent par grounding+self-check mais ne créent pas de row ai_quality_checks.

## Contraintes clés
- Citations inventées → logger mais NE PAS rejeter la sortie (grounding informe).
- Pas de cache sur self-check (run dans le miss closure → 1x par génération).
- ConfidenceDot seulement si confidence < high. Warning affiche le contenu.
- Review queue ADMIN_EMAILS only. Messages en 3 parties (patch-14).
