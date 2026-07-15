# Audit pipeline scraping → diff → classification → agrégation → alerte
Outrival · main@81c4b75 · 2026-07-09 · lecture seule (code + SELECT prod/dev)

Sources : données prod (DATABASE_URL_PROD, SELECT only, ~6 semaines de scans réels),
base dev (périmée 14/06), 6 audits code parallèles (scrapers SCR, diff DIF,
classifieur CLS, agrégation AGG, cascade CAS, promesses PRM) + follow-up SCR-20.
Jeu labellisé **validé** : `docs/audits/pipeline-audit-2026-07-09-golden-set.md`.

## Funnel mesuré (prod, 30 jours)

```
3 027 scrape_runs ──778 échecs (26 %)──────────────► rien d'utilisateur-visible
      │                                              (Activity pull-only ; notif à 60 j)
      ▼
   310 changes ──135 "non significatifs" (44 %)────► attendu (gate IA)
      │        ──39 JAMAIS classifiés (13 %)───────► perte silencieuse (parse_failed +
      │                                              AbortTaskRunError = zéro retry)
      ▼
   136 signaux ── 0 critical (6 semaines) ─────────► canal "≤5 min" jamais exercé
      │        ── 0 batch (seuil 3 jamais atteint, UI désactivée #77)
      ▼
   0 alerte immédiate jamais envoyée (table alerts VIDE depuis la création)
   27 digests générés → 6 envoyés (la seule org avec digest_email)
   → le seul canal de livraison réellement actif = in-app
```

Latences mesurables : détection→signal p50 1,6 min · p90 6,2 min · max 77 min.
Cadences réelles : realtime = 2 h · daily = 25 h · weekly = 168 h.
Qualité du feed (110 signaux labellisés, validés) : **48 % OK · 41 % MISLEADING · 11 % NOISE**.
Ratio changes:signaux = 2,3:1 (promesse landing : 70:1, indéfinie et incalculable —
les changes silencés ne sont pas persistés).

## Traces E2E (5 concurrents)

- **AGS** : homepage realtime = 67 snapshots / 32 hashes distincts / 0 change —
  le HTML flip-floppe (variantes de rendu), le dédup par hash ré-insère un snapshot
  (R2+DB) à chaque flip alors que le texte extrait est identique. Monitor jobs
  capture du contenu produit (mauvaise page). Coût sans valeur.
- **Productboard** : le lancement Spark = 5 signaux en 2 semaines (product×3,
  pricing×2), jamais reliés. Monitor news mort (unscrapable, cf=7) en silence.
- **ScrapingBee** : 8 changes pricing → 1 seul signal (gate significance + erreurs).
- **Supabase** : la meilleure trace (jobs Ashby structuré propre). Series F $500M
  détectée via news → **high**, pas critical. Sitemap/news OK.
- **linear.app** : weekly, jobs 7 changes, rien d'anormal.

Autres pertes structurelles (prod) : 46 monitors actifs jamais scrapés avec succès
depuis >48 h (11 homepage + 11 pricing + 13 blog + 8 news…) · 53 monitors blog
unscrapable (probing /blog|/changelog en L0 only) · g2/capterra : 1 monitor
chacun, unscrapable sans jamais avoir tourné · cascade : **zéro run L2+ en 30 j**,
requiresLevel NULL sur 785/785 monitors, 84 cloudflare_challenge + 87 blocked_403
non résolus → vérifier PROXYSCRAPE_* en prod (créds absentes OU proxies inopérants).

---

## Findings consolidés

Sév. = impact fiabilité des signaux (crit/med/low) · Effort S/M/L.
« plan NNN » = déjà couvert par plans/.

### 1. Scrapers (SCR)

| ID | Finding | Sév. | Effort |
|----|---------|------|--------|
| SCR-20 | **Staged extraction (patch-30) mort-né** : `replayExtractor` renvoie un tableau brut, validé contre `z.object({plans|jobs})` → heal jamais validé, `parser_extractors` vide à jamais, cooldown jamais armé (guard `if (cached)`), **405 appels IA/30 j en pure perte** (tier smart, HTML élagué 40K) — patch-30 DOUBLE le coût au lieu de le réduire. staged-extract.ts:139/146, cached-extractor.test.ts:35 | crit | S/M |
| SCR-4 | Pricing client-hydraté accepté à L0 (≥500 chars de marketing SSR) → scroll+toggle jamais exécutés, prix jamais capturés, `{ok:true, plansInserted:0}` = succès. Pas de render-floor pricing (contrairement à JOBS_RENDER_ENABLED). Vérifier recouvrement avec PR #124 | crit | S |
| SCR-10 | Extraction jobs LLM = 10 000 premiers chars → sous-ensemble non vide → mass-close des postes hors fenêtre (la garde C1 ne couvre que la liste VIDE) → churn closed/reopened | crit | M |
| SCR-1 | Premier snapshot sans AUCUNE garde d'emptiness (guards gated sur `lastSnapshot`) → baseline partielle → phantom "tout ajouté" au scrape suivant. Homepage seule protégée (isIncompleteRender) | med | S |
| SCR-2 | Aucun score de confiance/complétude d'extraction ; `snapshots.status` partial/failed = 0 writer. Proposition : `items_extracted` + `input_signal` (regex tokens prix/careers) sur `extraction_runs` | med | S/M |
| SCR-7/9 | Blog & changelog = L0 only (scrapeStatic), jamais d'escalade navigateur ; changelog "feed-first" est en réalité page-first (un échec page court-circuite le probing RSS) → 53 blogs morts en prod | med | S |
| SCR-8 | Pas de RSS-first pour blog alors que l'infra feeds existe (changelog) | med | S |
| SCR-11/12 | SmartRecruiters tronqué à 100 postes sans pagination ; Workable a une API JSON publique non utilisée ; BambooHR/Teamtailor/WTTJ non couverts | med | S/connecteur |
| SCR-13/14/15 | Reviews : verbatims = 1re page × 10K chars, JSON-LD `Review` non mappé, Play Store sans scroll (3-4 reviews teaser), page login Gartner stockée comme succès | med | S/M |
| SCR-16 | Status : 2 providers seulement, incidents actifs only → un incident plus court que l'intervalle de scrape est invisible (`incidents.json` non exploité) | med | S |
| SCR-17 | Sitemap : cap 5 000 URLs coupé en plein walk (ordre des documents) → subset non déterministe → phantom add/remove récurrents sur les GROS concurrents | med | S |
| SCR-19 | News : garde homonymes = substring → marques mots-communs ("Linear") = phantom funding | med | S |
| — | (data) monitor jobs/pricing sur la mauvaise page : Solano pricing→intérim, Dougs jobs→homepage, AGS jobs→produits ; `discoverPricingUrl` null → le monitor pricing tracke silencieusement la homepage | med | M |

### 2. Diff (DIF)

| ID | Finding | Sév. | Effort |
|----|---------|------|--------|
| DIF-1 | **`section_added/removed` structurellement impossible depuis #74** : le filtre de stabilité exige que la section soit présente dans le snapshot que le diff exige absente. Le test unitaire désynchronise historique et inputs pour passer. Classe de signal la mieux pondérée (0.95) = morte | crit | S |
| DIF-3 | Damping de récence GLOBAL au concurrent : ≥5 changes/sem n'importe où (blog, jobs) → recency ≤0.5 → même un hero réécrit intégralement est silencé AVANT classification | high | S |
| DIF-7 | `evaluateSignificance` rejette les diffs <50 chars / <30 chars non-numériques → **un simple changement de prix n'est jamais classifié** (change créé, jamais signalé) | high | S |
| DIF-5 | Redesign purement visuel : early-return hash-identique AVANT le pHash → le détecteur de redesign ne peut jamais tirer | med-high | M |
| DIF-6 | Changement de prix annual-only : bloc toggle hidden strippé du hash → early-return → même pricing_history ne bouge pas | med-high | M |
| DIF-4 | Poids×magnitude : ajout d'1 item nav ≈ 0.08 ; og:image (rebrand patch-32) mathématiquement < 0.5 toujours → mort-né | med-high | S |
| DIF-8 | Hero A/B ou tagline rotative = `hero_headline_changed` à CHAQUE scrape, aucune boucle d'apprentissage (volatile learning ne voit que bodyDiff) | med | M |
| DIF-12 | Soft-404 (200 + "Not Found" client) passe les gardes sur jeunes monitors → baseline erreur → faux "site refondu". Confirmé prod : 8/110 signaux labellisés = diffs 404/challenge→contenu | med | S |
| DIF-11 | Churn de représentation : switch HTML↔ATS-API, L0↔L1, proxy géo → gros faux diffs ; aucun garde ne compare le "capture kind" avant/après | med | M |
| DIF-10 | Sources lexicales sans AUCUNE couche d'apprentissage : horloges, réordonnancements de listes, bannières promo → ~30-35 % des change rows = bruit (absorbé APRÈS avoir payé la classification) | med | M |
| DIF-2/9/13/14/15 | Testimonials fenêtre exacte-3 · reviews typées "other" fuient · troncature 50K coupe le côté "added" d'abord · api-capture JSON volatile · homepage sans H1 mutée à vie | low-med | S-M |

### 3. Classifieur (CLS)

| ID | Finding | Sév. | Effort |
|----|---------|------|--------|
| CLS-1 | **Aucune rubrique de sévérité** : "critical" jamais défini pour le modèle, jamais informé qu'il déclenche un email immédiat. Mesuré : 0 critical en 6 semaines, Series F $500M → high, medium = fourre-tout (116/169) | crit | S |
| CLS-2 | Rubrique structurée pousse vers critical : "hero_headline_changed = ALWAYS major", `major ⇒ high|critical`, **medium n'a aucune règle de production** → distribution bimodale | crit | S |
| CLS-3 | Zéro garde déterministe entre le token "critical" du modèle et l'email (pas de confiance collectée, pas de règles de démotion, cap email explicitement bypassé) | crit | M |
| CLS-9 | `parse_failed` → `AbortTaskRunError` = retry désactivé → change perdu à jamais. Pire : insight qui échoue APRÈS is_significant=true → signal jamais créé. Prod : classify 20 % erreurs, insight 25 %, 39 changes/30 j jamais classifiés | high | M |
| CLS-7 | Sévérité absolue, pas relative au client : productProfile atteint l'insight mais jamais le classifieur ; cache 7 j sans orgId → une mauvaise sévérité rejouée cross-org | med-high | M |
| CLS-4/5 | Le classifieur flip-floppe entre gpt-oss-120b (Cerebras) et llama-3.1-8b (Groq) selon le quota du jour, température 1.0, jamais évalué ; `ai_runs.model` enregistre le modèle NOMINAL pas le réel → la mesure de calibration est confondue | med | S/M |
| CLS-6 | Catégories = enum nu, zéro définition/exemple ; la catégorie pilote batching+digests+UI | med | S |
| CLS-8 | Le classifieur voit 8 000/50 000 chars du diff, sans marqueur de troncature | med | S |
| CLS-10 | Le funnel de kill pré-IA est immesurable (silencés sans row, summary NULL ambigu) | med | S |

Golden set validé : accord catégorie ~87 % (sur les OK), accord sévérité ~60 %.
Biais : 0 critical jamais ; high sur-attribué aux artefacts (scripts HubSpot,
before corrompus rs≥0.95) ; vrais chiffrés sous-cotés medium.
La rubrique sévérité + règles catégorie du golden set est réutilisable telle quelle
comme rubrique de prompt.

### 4. Agrégation (AGG)

| ID | Finding | Sév. | Effort |
|----|---------|------|--------|
| AGG-1 | **Batching = write-only** : rendu UI désactivé (#77, commentaire explicite signals-view.tsx:390), aucun autre consommateur (digests ne lisent pas signal_batches) → cron 6 h + appel IA pour un output que personne ne voit | crit | M (ou S : le retirer) |
| AGG-2 | Clé de groupement = catégorie LLM unique → la refonte pricing (pricing+product+content cross-sources) ne matche JAMAIS. Prod : clusters max = 2 même-cat/jour, seuil 3 jamais atteint, **0 batch en 6 semaines** | crit | M |
| AGG-3 | Aucun dedup au niveau insight : Centauri $480→$400 = 2 signaux (pricing+jobs) à 90 s d'écart ; Grayscale homepage+pricing même minute ; Spark = 5 signaux/2 semaines. Chaque signal = son propre dispatch | crit | L (S pragmatique : suppression si signal non-lu même comp+cat < N h) |
| AGG-4 | Min 3 + fenêtre 24 h échantillonnée toutes les 6 h + batch fermé → sous-fusion même intra-catégorie | med | S |
| AGG-5 | Le prompt de summary AFFIRME la relation ("These N related changes") sans échappatoire | low→med | S |
| AGG-6 | Les digests (la couche sous laquelle la promesse est vendue) n'agrègent RIEN : daily = 1 ligne/signal, weekly = bucketing par urgence uniquement | med | S |

### 5. Cascade (CAS)

| ID | Finding | Sév. | Effort |
|----|---------|------|--------|
| CAS-1 | **Soft-block 200 avec >500 chars visibles passe comme snapshot succès** → diffé contre le vrai contenu → faux signaux. Confirmé prod (TargetRecruit "Checking the site connection security" en hero before, rs=1.0). Seule la homepage a une garde structurelle | crit | M |
| — | (data) **Zéro run L2+ en 30 j en prod**, 785/785 requiresLevel NULL, 84 CF challenges non résolus → PROXYSCRAPE_* absent ou inopérant en prod. À vérifier en 5 min dans Coolify | crit? | S |
| CAS-2 | Timeout n'escalade jamais → un site qui tarpit l'IP serveur = unscrapable sans jamais tenter un proxy ; homepage floored L1 ne peut même pas redescendre | med | S/M |
| CAS-3 | 403 à L0 saute le L1 gratuit → paie du datacenter pour des blocks fingerprint qu'un navigateur same-IP résout | med (coût) | S |
| CAS-4 | Mort silencieuse d'un monitor invisible ≤60 j sauf à ouvrir Activity ; le dot de fraîcheur de la liste EXCLUT les unscrapables → un concurrent tout-mort affiche "Stale" pas "failed" | med | M |
| CAS-5 | requiresLevel ratchet : un site re-devenu accessible paie du résidentiel ≤14 j (homepage realtime ≈ 336 renders résidentiels avant re-probe) ; échec du re-probe repousse de 14 j | med (coût) | S/M |
| CAS-6 | Kill-switches décalés d'un niveau (`SCRAPING_LEVEL_3_ENABLED` coupe L4 pas L3) → l'opérateur qui veut couper un tier supérieur en coupe un autre (tiers supérieurs L3/L4 depuis retirés par la doctrine de collecte) | low | S |
| CAS-7 | Page légitimement rétrécie <600 chars = piégée unscrapable à vie (anti-void throw avant commit → la petite taille n'entre jamais dans la médiane) | low | S |
| CAS-8 | Les runs échoués loggent `level = requiresLevel ?? 0` → la dépense proxy des ÉCHECS est invisible de l'alarme de coût | low | S |

Coûts/1000 scrapes : L0-L2 ≈ 0 $ marginal · L3 data-source ~2 $ · L3/L4 homepage
(~5 MB, images non bloquées pour le screenshot) **~10 $**. Cliff n°1 : homepage
realtime épinglée L3 ≈ 4-11 $/mois/homepage.

### 6. Promesses publiques (PRM) — matrice

| Claim (copy exacte) | Tenable by design | Mesuré | Risque |
|---|---|---|---|
| "≤5min critical alert latency" (trust.tsx:29) | Partiellement : détection→alerte only ; **inexistant sur Free/Starter** (send-alert gate realtimeAlerts pro+) ; p90 détection→signal déjà 6,2 min | Calculable (timestamps complets), jamais calculé ; alerts = 0 rows | **crit** |
| "70:1 noise to signal" + "filters out 99%" (trust.tsx:15, faq:17, json-ld) | Aucune définition ; numérateur (changes silencés) non persisté | Proxy mesurable : 2,3:1 | med-high |
| "Scanned hourly" (product-showcase:13) | Non : cron horaire ≠ monitors (realtime réel = 2 h, decay 12 h ; free = weekly). La FAQ du même écran dit l'inverse | Oui (scrape_runs) : 2 h/25 h/168 h | med |
| "100% EU / stored data never leaves the EU" (trust:37, faq:21) | **Contredit par /subprocessors** : R2 `outsideEea:true` (c'est LÀ que vivent les snapshots), Trigger/Resend/Groq/Cerebras US | n/a | **crit** (RGPD, falsifiable en 2 min par un DPO) |
| "6 categories × 4 severities" (categories:49) | Oui | Oui — mais 0 critical/0 funding jamais émis sur certaines cellules | low |
| "Smart aggregation — not 4 separate alerts" (digest-feature:52) | Non aujourd'hui (AGG-1/2/3) | signal_batches = 0 | med |
| "Diffed against previous state" (sources:66) | Oui | Oui | low |
| "15+ source types" (trust:21) | linkedin/twitter n'ont AUCUN scraper, reddit off → max sélectionnable = 13 | Oui | med |
| "First signal in under 10 minutes" (cta:12) | Dépend du backfill Wayback best-effort | **Déjà instrumenté** (onboarding_sessions.timings.first_real_signal) et jamais lu | med |
| "One email. Monday morning." (hero:47) | Skip silencieux si semaine calme — plan 017 (PR #144 open) | digests.sent_at | med |
| API business (docs page) | Paid-undelivered — plan 018 (PR #143, HIDE) | n/a | high |

PRM-2 (piège de mesure) : `decideDispatch` stampe `dispatched_channel='email_immediate'`
AVANT le gate de plan → des orgs Free ont des signaux marqués envoyés-immédiat alors
que rien n'est parti. Toute métrique future de latence/délivrance sur-reportera.
+ digests : 21/27 générés jamais envoyés (orgs sans digest_email), aucune trace d'erreur.
+ `alerts.error` enregistré mais jamais surveillé (une clé Resend cassée = outage total silencieux).

### 7. Exploration libre (hors périmètre demandé)

- **Bruit tech_stack = 28 % du feed** (31/110 labellisés) : première détection d'une
  tech EN PLACE ("Supabase is now using Vercel") émise comme signal "product/medium"
  (4 en high pour un script HubSpot). L'insight affirme "has started using" —
  factuellement faux. Aucun garde "baseline run" dans scrape-tech-stack.
- **Compteurs de job boards** : Clikhire (qui EST un job board) = 4 signaux "hiring"
  sur son compteur 2657→2971→2944. Contexte concurrent absent du classifieur (CLS-7).
- **AGS homepage** : dédup par hash du HTML brut → 67 snapshots/32 hashes pour 0
  change (flip-flop de variantes) = stockage R2/DB en boucle.
- Fuite de vocabulaire interne dans un insight user-facing ("changed its pricing page
  status from public_partial to dynamic").
- Backfill archive : les diffs Wayback-vs-now sont phrasés comme des annonces
  ("announced", "introduced") et plusieurs before archivés sont des pages de
  challenge Cloudflare → "launch delayed"/"acquisition" fabriqués (badge From
  archive présent, mais le texte ment).
- ai_visibility "overtaken 0 %→100 %" ×3 dans le feed — déjà connus (plan 001,
  #122 non mergé, #129 open).

---

## Instrumentation minimale avant les premiers clients

1. **SLO latence critical** : bloc ops-health-check p95(alerts.sent_at −
   changes.detected_at) > 300 s → Slack ; tuile admin p50/p95. Pré-requis :
   corriger le stamp dispatched_channel (PRM-2).
2. **Ratio bruit** : +2 colonnes best-effort sur scrape_runs (`changes_detected`,
   `changes_silenced`) au point du filtre de pertinence ; tuile admin + seuil.
3. **Complétude d'extraction** : `items_extracted` + `input_signal` sur
   extraction_runs (SCR-2) ; alarme "page avait des données, extracteur = 0".
4. **Cadence** : tuile médiane inter-scan par fréquence (requête déjà écrite).
5. **Time-to-first-signal** : lire `onboarding_sessions.timings.first_real_signal`
   (existe déjà, jamais affiché) ; % < 10 min.
6. **Délivrance** : agréger `alerts.error` + digests générés-vs-envoyés dans
   ops-health-check.
7. `ai_runs.model` = modèle réel (markModel, ~10 lignes) — sinon la calibration
   par modèle est confondue (CLS-5).

## Top 5 corrections par impact fiabilité

1. **Garde anti-page-bloquée/404 sur le chemin SUCCÈS** (CAS-1 + DIF-12 + SCR-1 +
   before archivés) : heuristique deny-page/soft-404/challenge appliquée avant de
   committer un snapshot (elle existe déjà dans diagnose-failure.ts, côté échec) +
   garde d'emptiness sur le premier snapshot. Effort S/M. Gain : élimine la classe
   MISLEADING la plus grave (~8-10 % du feed dont les pires "high" rs≥0.95).
2. **Tuer le bruit tech_stack** : pas de signal au run baseline d'un competitor,
   reformuler "detected" (pas "started using"), redescendre hosting/scripts
   marketing sous le seuil d'importance. Effort S. Gain : −28 % du feed, fin des
   faux high HubSpot.
3. **Rubrique de sévérité + garde déterministe critical + retry parse_failed**
   (CLS-1/2/3/9) : définir critical/high/medium/low dans les 2 prompts (la rubrique
   du golden set est prête), règles de démotion déterministes avant email,
   remplacer AbortTaskRunError par un throw retriable + fallback insight template.
   Effort S/M. Gain : protège la promesse phare dans les DEUX sens + récupère les
   13 % de changes perdus.
4. **Ranimer les classes de signaux mortes** : DIF-1 (section add/remove), DIF-7
   (price tweak jamais classifié), DIF-3 (recency scopé homepage), DIF-4 (og:image),
   SCR-4 (render-floor pricing si aucun token prix à L0). Effort S chacun. Gain :
   ce sont exactement les signaux vendus par la landing (pricing + positionnement).
5. **SCR-20 staged extraction** : wrapper `{plans|jobs}` + normalisation par kind
   aux stages 2/3, stub row pour armer le cooldown, test de régression
   heal→cache. Effort S/M. Gain : coût IA d'extraction ÷2 (~405 appels smart-tier
   /mois économisés) + le cache promis par patch-30 devient réel.

Mentions immédiates hors top 5 : vérifier PROXYSCRAPE en prod (5 min, débloque
peut-être 26 % d'échecs) · copy fixes landing (EU !, hourly, 15+, high ≤5 min) ·
stamp dispatched_channel honnête · décision batching (réparer AGG-1/2 ou retirer
la feature et la claim).
