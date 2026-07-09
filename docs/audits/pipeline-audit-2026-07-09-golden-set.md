# Golden set — 110 signaux prod labellisés (2026-06-29 → 2026-07-09)

> **Statut : VALIDÉ par Mathys le 2026-07-09** (labels et verdicts approuvés tels quels).
> Usage : jeu de régression du classifieur — toute itération sur les prompts de
> classification (catégorie/sévérité) doit être mesurée contre ce set.
> Contexte complet : `docs/audits/pipeline-audit-2026-07-09.md`.

Verdicts : **OK** = signal réel et actionnable · **NOISE** = pas digne d'un signal ·
**MISLEADING** = artefact pipeline présenté comme un fait (fausse adoption tech,
diff 404→page, challenge-page en before, compteur de job board…).
Labels `cat/sev` = label correct validé.

Règles de sévérité validées (rubrique absente du prompt actuel — à y intégrer) :
- **critical** : changement de structure pricing d'un concurrent direct · levée ≥$100M d'un concurrent direct · lancement produit attaquant frontalement le positionnement du client · acquisition/pivot majeur
- **high** : lancement produit notable · changement de prix chiffré · repositionnement hero complet · série d'embauches stratégiques
- **medium** : évolution incrémentale réelle (nouvelle offre d'emploi, section ajoutée, promo)
- **low** : cosmétique (copy mineure, meta tags, docs)

| # | id | comp | src | modèle | validé | verdict | raison |
|---|----|------|-----|--------|--------|---------|--------|
| 1 | 0e8b694f | Supabase | jobs | hiring/med | hiring/med | OK | vraies offres Ashby |
| 2 | d56f414d | Citus | pricing | pricing/med | –/– | MISLEADING | page marketing, prix $0.27/h préexistant (diff = re-listing page) |
| 3 | 25034b4c | Supabase | news | funding/high | funding/**critical** | OK | Series F $500M @ $10.5B — l'événement le plus grave du set |
| 4 | d4a56e78 | Supabase | sitemap | product/med | content/low | NOISE | pages docs Dart = bruit docs |
| 5 | 28f91c00 | Soli | homepage | product/med | content/low | OK (backfill) | award 2026 ajouté — mineur |
| 6 | 279a1f82 | ProductOS | pricing | pricing/med | pricing/high | OK | nouveau modèle credits + tiers |
| 7 | cce064ae | ProductOS | homepage | product/high | content/med | OK | hero réécrit (2e fois en 4 j) |
| 8 | a7c8f3a6 | Dougs | jobs | hiring/med | hiring/med | OK | vraies offres WTTJ |
| 9 | fad1614c | Solano | pricing | hiring/med | –/– | MISLEADING | monitor *pricing* qui scrape des offres d'intérim (mauvaise page) |
| 10 | 4da1482c | Pulltrader | blog | product/med | product/high | OK | Scout AI launch (dupliqué #13, #14) |
| 11 | 2d80eb4c | MTGStocks | pricing | pricing/med | pricing/high | OK | nouveau premium multi-tiers |
| 12 | 911af4a8 | Game Locker | pricing | pricing/med | pricing/med | OK | trial 30j + limites |
| 13 | 332b6b83 | Supabase | jobs | hiring/med | hiring/low | OK | 1 poste partnerships |
| 14 | bc5422d9 | Pulltrader | blog | product/med | product/high | OK | même event que #10 (autre org) |
| 15 | 6de4ff6c | Collectr | homepage | content/high | content/high | OK | hero refonte (dup cross-org #36, 3 j d'écart) |
| 16 | 1aeb2e28 | ElixirNode | pricing | pricing/med | –/– | MISLEADING | "changed status public_partial→dynamic" = vocabulaire INTERNE d'extraction dans l'insight |
| 17 | 5d84f717 | Iceline | pricing | pricing/med | pricing/med | OK | offre DDoS chiffrée |
| 18 | e7f3bfc8 | Iceline | tech_stack | product/med | –/– | MISLEADING | "now uses Vercel" = 1re détection, pas une adoption |
| 19 | de498d0d | Haptic | tech_stack | product/med | –/– | MISLEADING | idem Vercel |
| 20 | 47887f4f | Dougs | jobs | pricing/med | –/– | MISLEADING | monitor jobs capture la home pricing (mauvaise page) |
| 21 | 3886997e | CardNexus | ai_visibility | content/high | –/– | MISLEADING | 0%→100% = run dégradé (plan 001/#129) |
| 22 | 7db630bb | Harvestr | ai_visibility | content/med | content/low | NOISE | 10 % sur quota minuscule |
| 23 | 32148ace | ProductOS | ai_visibility | content/med | content/low | NOISE | idem |
| 24 | 747166f6 | Krisspy | ai_visibility | content/med | content/low | NOISE | idem |
| 25 | 355d2770 | Beehire | pricing | pricing/med | pricing/med | OK | page tarifs détaillée |
| 26 | 128970bc | Cortex | jobs | hiring/med | hiring/med | OK | vrai poste senior |
| 27 | 744bb75a | SlideLizard | pricing | product/med | product/high | OK | lancement LIZ AI |
| 28 | 5cc21593 | Supabase | jobs | hiring/med | hiring/low | OK | 1 poste EA |
| 29 | b4197443 | HebergHub | pricing | pricing/med | –/– | MISLEADING (backfill) | before = page de vérification Cloudflare |
| 30 | 3cd8fd34 | HebergHub | homepage | product/med | –/– | MISLEADING (backfill) | idem — "launch delayed" déduit d'un before corrompu |
| 31 | 4d1f3525 | Imperium | pricing | product/med | pricing/med | OK (backfill) | catalogue + prix (dup #32) |
| 32 | 51140e57 | Imperium | homepage | pricing/med | pricing/med | OK (backfill) | dup de #31 même diff (2 monitors, même contenu) |
| 33 | 1b18bb8f | HostNoc | pricing | pricing/med | pricing/high | OK (backfill) | -60 % réel |
| 34 | 168a763d | Haptic | homepage | pricing/med | pricing/med | OK (backfill) | promos (dup #35) |
| 35 | c1d52a6e | Haptic | pricing | pricing/med | pricing/med | OK (backfill) | dup de #34 |
| 36 | f3834996 | Iceline | homepage | pricing/med | pricing/med | OK (backfill) | before/after incohérents (29.99→43 vs "new tiers") |
| 37 | e73a2a44 | WinHeberg | pricing | product/med | product/low | OK (backfill) | upgrade CPU/NVMe |
| 38 | c960fb29 | ZAP | homepage | pricing/med | pricing/med | OK (backfill) | -5–6 % |
| 39 | 94c4fdca | Dougs | tech_stack | product/med | –/– | MISLEADING | Netlify "started using" |
| 40 | e427d4e9 | Dougs | tech_stack | product/high | –/– | MISLEADING | HubSpot script = high ! fatigue d'alerte |
| 41 | 7d40ee4f | Qonto | pricing | pricing/high | pricing/med | OK (backfill) | rémunération 4→5 % réelle |
| 42 | ed49167a | LegalPlace | pricing | pricing/med | content/low | NOISE (backfill) | reformulation page tarifs |
| 43 | f1c1a446 | Dougs | homepage | pricing/med | pricing/med | OK (backfill) | 2 mois offerts (dup #44) |
| 44 | b3e09ff7 | Dougs | pricing | pricing/med | pricing/med | OK (backfill) | dup de #43 |
| 45 | ebe21202 | Solano | pricing | hiring/med | –/– | MISLEADING (backfill) | même mauvaise page que #9 |
| 46 | d3635001 | TargetRecruit | jobs | content/high | –/– | MISLEADING | before = "Robot Challenge Screen" ; chg_summary parle d'acquisition, insight d'AI Agents |
| 47 | a401c701 | Beehire | pricing | pricing/high | pricing/high | OK | Starter €95→€80 |
| 48 | 32151c7b | Pulltrader | pricing | product/med | product/med | OK | vault/self-listing (lié #10) |
| 49 | 884503fa | Centauri | pricing | pricing/high | pricing/high | OK | $480→$400 (dup #50 cross-source, 1,5 min d'écart) |
| 50 | 99548e97 | Centauri | jobs | pricing/med | –/– | MISLEADING | monitor *jobs* émet le même pricing que #49 — dup non fusionné |
| 51 | a9d73f6a | Lane | ai_visibility | content/high | –/– | MISLEADING | 0%→100 % dégradé |
| 52 | e1ecb082 | Harvestr | ai_visibility | content/high | –/– | MISLEADING | 0%→50 % dégradé |
| 53 | 803a5acf | INXY | pricing | product/med | product/low | NOISE | contenu corporate large, pertinence faible (so_what l'admet) |
| 54 | 611d9959 | Grayscale | homepage | product/med | product/high | OK (backfill) | lancement Gracie (dup #55) |
| 55 | f04e0f75 | Grayscale | pricing | product/high | product/**critical**? | OK (backfill) | chg_summary dit "acquisition par Paylocity" — si vrai, critical ; insight dit "intégré à Paylocity" — incohérent |
| 56 | b8f0b059 | TargetRecruit | homepage | product/high | –/– | MISLEADING | before hero = "Checking the site connection security" (challenge page), rs=1.0 |
| 57 | 36b7ee39 | Collectr | homepage | content/high | content/high | OK | dup cross-org de #15 |
| 58 | 138cdea7 | Slidely | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 59 | a82589fc | Decktopus | tech_stack | product/med | –/– | MISLEADING | Intercom dom match |
| 60 | 4a79f786 | ProductOS | homepage | product/high | content/med | OK | hero v1 (séquence avec #7) |
| 61 | d2e67bca | Citus | jobs | hiring/med | –/– | MISLEADING | "hiring for Postgres team" halluciné depuis une page marketing statique |
| 62 | 6c2908df | Supabase | jobs | hiring/med | hiring/med | OK | PM Multigres → Control Plane Eng |
| 63 | c8c798e5 | Nile | jobs | hiring/med | hiring/med | OK | founding engineers (page About) |
| 64 | 5065b05c | Codebenders | pricing | pricing/high | –/– | MISLEADING | before = "404 Not Found" stocké comme snapshot → "nouveaux tiers" |
| 65 | 05d1c47f | Simplita | homepage | pricing/high | content/med | OK | expansion site massive, cat discutable (sections FAQ pricing) |
| 66 | d6086bcd | Lane | pricing | pricing/med | –/– | MISLEADING | before = 404 |
| 67 | 8db463c4 | SeekLab | jobs | content/med | –/– | MISLEADING | before = 404 → "nouvelle landing" |
| 68 | 2d70cf2b | Zyte | homepage | pricing/high | pricing/high | OK | section pricing ajoutée (structured propre) |
| 69 | 80bc36e3 | CollX | pricing | product/med | product/med | OK | CollX Pro détaillé |
| 70 | bdd520b0 | MTGStocks | pricing | pricing/med | –/– | MISLEADING | before = "File not found" |
| 71 | 612c2603 | CardsIQ | homepage | pricing/high | product/med | OK | section Recent Transactions (sev gonflée, rs 0.95) |
| 72 | d1c05f88 | Pulltrader | jobs | hiring/med | hiring/med | OK | before "Loading positions..." → vrais postes (JOBS_RENDER fix visible) |
| 73 | 54ad9b68 | Misprint | homepage | content/high | –/– | MISLEADING | hero "MARKET VOLUME" = label de chart capturé comme headline |
| 74 | 3b4f479a | Supabase | jobs | hiring/med | hiring/med | OK | Data Engineer +, Counsel − |
| 75 | cfbcf152 | Nile | jobs | product/high | product/high | OK | refonte produit multi-tenant (depuis careers page) |
| 76 | e345d5ad | CardNexus | jobs | hiring/med | hiring/med | OK | vrais postes + expansion |
| 77 | 3c04c412 | Supabase | tech_stack | product/med | –/– | MISLEADING | Supabase "now using Vercel" (depuis toujours) |
| 78 | 41607b76 | Dexbit | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 79 | 38f2992a | Prodmap | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 80 | e6f0fe15 | ProductOS | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 81 | eeba79b4 | Nile | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 82 | 611a9494 | Zentrik | tech_stack | product/med | –/– | MISLEADING | Zendesk |
| 83 | 636ec7b1 | CardNexus | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 84 | 38c44bc0 | Nhost | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 85 | 735df204 | Neodelta | homepage | content/high | content/med | OK | repositionnement agence |
| 86 | 77c06c8f | Pulltrader | homepage | product/high | product/high | OK | pivot OS card shops (cohérent #10/#48) |
| 87 | ab04200a | Clikhire | jobs | hiring/med | –/– | NOISE | compteur job board 2971→2944 (Clikhire EST un job board) |
| 88 | 7c1a5d8c | Pulltrader | pricing | pricing/med | pricing/high | OK | tiers $9/$39/$99 + fees |
| 89 | ed45e026 | Back4app | pricing | pricing/med | pricing/med | OK | grille tarifaire |
| 90 | a96baa91 | AGS | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 91 | 29afe33b | Codewolf | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 92 | 89d3b650 | Unisire | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 93 | c959135f | Coding4Youth | tech_stack | product/med | –/– | MISLEADING | Zendesk |
| 94 | dbd6c96c | Misprint | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 95 | 05406775 | Paragon | tech_stack | product/med | –/– | MISLEADING | Zendesk (integrations page = préexistant) |
| 96 | 758aabe0 | API Platform | tech_stack | product/high | –/– | MISLEADING | HubSpot script = high |
| 97 | 20cb5393 | TCG Unite | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 98 | 26846059 | Next-Gen CTO | tech_stack | product/med | –/– | MISLEADING | Vercel — insight = copie verbatim du diff technique |
| 99 | 71affbde | CardNexus | tech_stack | product/med | –/– | MISLEADING | Vercel (3e fois cross-org) |
| 100 | 663e795f | Centauri | tech_stack | product/med | –/– | MISLEADING | Netlify |
| 101 | ef250591 | Cortex | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 102 | 977500a9 | Clikhire | jobs | hiring/med | –/– | NOISE | compteur 2840→2971 |
| 103 | 1f582bd1 | Clikhire | jobs | hiring/med | –/– | NOISE | compteur 2692→2840 |
| 104 | 6c0c1f6b | Harvestr | tech_stack | product/med | –/– | MISLEADING | Zendesk |
| 105 | ff26e917 | WingmanPM | tech_stack | product/med | –/– | MISLEADING | Vercel |
| 106 | 8c21a5b3 | WingmanPM | tech_stack | product/med | –/– | MISLEADING | Zendesk |
| 107 | 72f3da92 | Clikhire | jobs | hiring/med | –/– | NOISE | compteur 2657→2692 |
| 108 | d999c184 | WebScrapingAPI | homepage | pricing/high | –/– | MISLEADING | "removed all sections" = render incomplet probable, rs 0.95 |
| 109 | 63f0329a | Beehire | tech_stack | product/high | –/– | MISLEADING | HubSpot high |
| 110 | 51b80d37 | HireSweet | tech_stack | product/high | –/– | MISLEADING | HubSpot high |

## Stats (labels validés)

- **OK : 53/110 (48 %)** — dont 12 backfill (in-app only, corrects mais phrasés comme des annonces)
- **MISLEADING : 45/110 (41 %)** — tech_stack fausses adoptions (31), before corrompu 404/challenge (8), mauvaise page scrapée (4), ai_visibility dégradé (3, déjà plan 001), vocabulaire interne exposé (1), autres (hallucination marketing page)
- **NOISE : 12/110 (11 %)** — compteurs job board (4), ai_visibility 10 % (3), docs/sitemap (1), reformulations (4)

### Accord catégorie (sur les 53 OK) : ~87 % — confusions principales :
- product ↔ content sur les hero changes (le modèle met product/high, souvent content/med)
- pricing ↔ product quand une page pricing lance une feature (#27, #71)
- source jobs → catégorie pricing/product quand la page careers contient du marketing (#20, #50, #61, #75)

### Accord sévérité (sur les 53 OK) : ~60 % — biais systématiques :
- **0 critical émis en 6 semaines** : Series F $500M (#3) et acquisition Paylocity possible (#55) restent high/med → le canal "critical ≤5 min" n'a jamais été exercé
- **medium = fourre-tout** (116/169 en prod) ; les vrais high (prix chiffrés) sous-cotés medium (#11, #88, #33)
- **high sur-attribué aux artefacts** : structured homepage avec rs élevé sur before corrompu (#56 rs=1.0, #108 rs=0.95) et tech_stack HubSpot (#40, #96, #109, #110) → 4 des ~14 high récents sont des scripts marketing
