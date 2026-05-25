# Task Plan — Outrival

Mis à jour automatiquement par Claude Code à chaque session.

## Phases du projet

- [x] Phase 0 — Scaffold monorepo (turbo, tsconfig, packages vides, CI vert)
- [x] Phase 1 — Foundation (monorepo, auth, DB schema, dashboard shell)
- [x] Phase 2 — Scraping Core (Crawlee, diff engine, change feed)
- [x] Phase 3 — Intelligence IA (Groq classify+insight+digest, alertes, cron)
- [x] Phase 4 — Competitor Discovery (Exa.ai, onboarding, overlap scoring)
- [x] Phase 5 — Enrichissement (jobs, reviews, pricing history, fiche complète)
- [ ] Phase 6 — Battle Cards & Alertes (export PDF, alertes temps-réel)
- [ ] Phase 7 — Monétisation (Stripe, free tier limits, landing page)

## Phase en cours
Phase 6 — Battle Cards & Alertes (prochaine)

## Étapes session actuelle (Phase 5 — terminée 2026-05-25)

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
