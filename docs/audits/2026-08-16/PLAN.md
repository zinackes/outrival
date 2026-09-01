# Audit Outrival, 2026-08-16

Charte de l'audit. À relire et amender **avant** de lancer quoi que ce soit.

## 1. Cible et compte

| | |
|---|---|
| Environnement | **production** (`https://outrival.app`, API `https://api.outrival.app`) |
| Compte | compte perso de Mathys, **non admin**, connexion **Google OAuth** |
| Session | **cookies importés du navigateur**, Google ne s'automatise pas en headless |
| Plan | **Pro** attendu, vérifié et écrit par le harness dans `session-check.json` |
| Mutations | **autorisées**, sauf les deux exceptions ci-dessous |
| Rédaction du rapport | modèle principal de session (Fable 5), jamais déléguée |
| Modèles sous-agents | `sonnet` partout, épinglé explicitement sur chaque appel |
| Priorité | **exhaustivité** ; les tokens ne sont pas une contrainte, le quota de requêtes si (voir « Quota de requêtes ») |

Le compte n'étant pas admin, les **23 pages `/admin/*`** sortent du périmètre
navigateur. Elles restent couvertes en audit de code (phase 1).

### Exceptions à « j'autorise tout »

Deux actions demandent un go explicite au moment où elles se présentent, parce
qu'elles sont irréversibles ou facturées :

1. `/dashboard/settings/danger` : suppression de compte, purge d'org, révocation.
2. `/dashboard/settings/billing` : tout ce qui touche Stripe **live** (upgrade,
   downgrade, annulation, portail de facturation).

Le reste est ouvert : créer un produit, lancer une discovery, générer une battle
card, ajouter un concurrent, modifier les préférences, inviter un membre.

### Contraintes de prod à respecter

- **Cap IA de 10 actions/heure**, tous plans confondus. Les actions IA de la
  phase 3 sont **sérialisées et budgétées**, sinon les agents suivants
  rapporteront des faux positifs (« bouton mort » alors que c'est un 429).
- Emails Resend réels et notifications réelles : attendus, pas des bugs.
- Le crawl (phase 2) est **strictement read-only** : il navigue, il ne clique
  jamais. Il est donc rejouable à volonté, y compris après les correctifs.

## 2. Périmètre

### Couvert

**93 routes** au total dans `apps/web/src/app`.

| Groupe | Routes | Navigateur | Code |
|---|---|---|---|
| Public / marketing / légal | 35 | oui | oui |
| Dashboard (authentifié) | 35 | oui | oui |
| Admin | 23 | non (compte non admin) | oui |

Sept routes dynamiques ont besoin d'IDs réels, résolus par `inventory.mjs` :
`competitors/[id]`, `products/[id]`, `digests/[id]`, `brief/[id]`,
`report/[token]`, `blog/[slug]`, `admin/users/[id]` (hors périmètre).

### Non couvert, et dit explicitement dans le rapport final

- Les pages admin en rendu réel.
- L'onboarding réel d'un nouvel inscrit, faute de second compte.
- L'isolation multi-tenant au runtime, pour la même raison.
- Les parcours de paiement Stripe de bout en bout.
- La charge / le stress. Cet audit mesure la justesse, pas la tenue en charge.
- Les emails réellement délivrés (on audite le rendu via `/dev/preview-emails`,
  pas la délivrabilité).

### Baseline à ne pas re-découvrir

Trois audits antérieurs existent et doivent être injectés dans le contexte des
sous-agents, sinon ils re-rapporteront des choses déjà tranchées :

- `docs/audits/interface-2026-07-25.md`
- `docs/page-audit-2026-06-30.md`
- `docs/optimization-audit-2026-06.md`
- `docs/ai-consumption-audit-2026-08.md`

## 3. Emplacement des artefacts

Le harness vit dans le repo, **les sorties vivent en dehors** :

```
docs/audits/2026-08-16/harness/     scripts (versionnés)
docs/audits/2026-08-16/REPORT.md    rapport final (versionné)

~/.outrival-audit/state.json        session authentifiée (JAMAIS dans le repo)
~/.outrival-audit/2026-08-16/       routes.json, résultats, screenshots
```

Raison : `state.json` contient un jeton de session valide, et la règle git du
repo impose `git add -A`. Un secret déposé dans l'arbre serait committé au
prochain commit. Les ~750 screenshots (plusieurs centaines de Mo) n'ont rien à
faire dans l'historique non plus.

## 4. Phases

L'audit tourne en **trois sessions**. `RUN.md` donne le message exact à coller
pour chacune, et ce qu'il faut vérifier entre deux ; ce fichier-ci dit le
pourquoi. Elles
communiquent par les fichiers de `~/.outrival-audit/2026-08-16/`, jamais par le
contexte.

| Session | Phases | Agents | Durée de calcul | Fenêtres de quota |
|---|---|---|---|---|
| 1 | phase 1, code | 40 à 120 | 40 à 70 min | 1 à 2 |
| 2 | phases 2 et 3, crawl puis produit | ~25 | 50 à 70 min | 1 |
| 3 | phases 4 et 5, réfutation puis rapport | 60 à 90 | 50 à 70 min | 1 à 2 |

Découper n'est pas une concession au budget. Une session unique passerait la
moitié de l'audit au-dessus de 200k de contexte, où chaque tour est refacturé et
où la compaction commence à effacer les artefacts au moment précis où on en a
besoin (`.claude/rules/linear-workflow.md`). Trois sessions courtes, chacune
partant d'un contexte propre et lisant ses entrées sur le disque, tiennent une
exhaustivité qu'une session longue ne tient pas.

### Quota de requêtes, la vraie horloge

Le quota 5 h se compte en **requêtes API** (~500 par fenêtre, mesuré le
2026-08-08), et chaque tour de chaque sous-agent est une requête. Un agent coûte
donc ~14 requêtes, pas une : mesuré le 2026-08-30, 35 agents épuisent une
fenêtre. C'est le chiffre qui manquait à la première version de ce plan, qui
budgétait la phase 4 comme si un agent valait une requête. La session 1 dépasse
une fenêtre : **bloquer sur la limite d'usage y est le déroulement normal, pas
une panne.** Lancer chaque session en début de fenêtre,
et reprendre à la fenêtre suivante avec `resumeFromRunId` ; le préfixe déjà
exécuté revient du cache sans recoûter. Les durées du tableau sont du temps de
calcul, pas du temps mural.

### Phase 0, harness : TERMINÉE le 2026-08-16

Accès prouvé, plan **Pro** confirmé, **80 routes** résolues, smoke crawl vert.

Un piège trouvé pendant la validation, et corrigé dans `settle.mjs` :
`networkidle` ne se déclenche jamais sur une page authentifiée, parce que
`notifications-bell.tsx` ouvre un `EventSource` dans le shell du dashboard. Non
corrigé, l'inventaire perdait 5 des 7 seeds et le crawl aurait gaspillé environ
35 minutes en timeouts, tout en photographiant des skeletons de chargement que
les agents auraient rapportés comme des pages cassées.

Restent non résolus : `/brief/[id]` et `/report/[token]`, qui n'existent qu'une
fois un partage créé. À générer en phase 3, où les mutations sont autorisées.

1. `adopt-cookies.mjs` : convertit un « Copy as cURL » du navigateur en
   `state.json`, puis **prouve l'accès** en chargeant le dashboard et en
   relisant le plan. Le compte étant en Google OAuth, la session est importée,
   pas recréée. Le jeton étant HttpOnly, `document.cookie` ne suffit pas.
2. `pnpm add -D axe-core --filter @outrival/web` : prérequis de l'angle
   accessibilité. Sans lui le crawler tourne quand même, en sautant axe.
3. `inventory.mjs` : moissonne les liens réels depuis `/sitemap.xml` et depuis
   les pages de liste du dashboard, fusionne avec la table de routes statiques,
   écrit `routes.json`. Aucune supposition sur les contrats d'API.
4. Vérification : `session-check.json` confirme le plan, et `routes.json`
   contient au moins une URL concrète pour chacune des 6 routes dynamiques du
   périmètre.

**La valeur des cookies ne transite jamais par une conversation.** Elle est
écrite dans `~/.outrival-audit/curl.txt` par Mathys, lue par le script, jamais
affichée : les logs n'impriment que les *noms* de cookies.

### Phase 1, audit de code (workflow, 40 à 120 agents `sonnet`)

**Session 1.** `improve deep` fanné sur une matrice **package × angle de
lecture**, et non un agent par package. Un agent seul lit un package en largeur
et s'arrête au premier finding plausible de chaque zone ; cinq agents relisent le
même code cinq fois avec cinq questions différentes, et c'est là que vit la
seconde moitié des findings.

Les 8 packages : `web`, `api`, `workers`, `db`, `ai`, `scrapers`, `queue`,
`shared`. Les 5 angles :

| Angle | Ce qu'il cherche |
|---|---|
| `security` | scoping tenant avant tout, puis sessions, CORS, secrets côté client, SSRF, surface d'injection de prompt |
| `correctness` | logique fausse, `noUncheckedIndexedAccess` non respecté, promesses non attendues, catch vides, courses entre workers |
| `performance` | N+1, requêtes sans `LIMIT`, index manquants pour les filtres réels, ce qui coûte de l'argent par appel |
| `tests` | pas la couverture, le risque : quel chemin casserait la prod et n'a pas de test |
| `debt` | code mort, logique dupliquée qui divergera, `any` sans garde, docs qui contredisent le code |

**Boucle jusqu'à épuisement.** Le tour 1 lance les 40 paires. Les tours suivants
ne relancent que les paires **productives**, en leur donnant la liste de ce qui
est déjà trouvé et la consigne de trouver ce que le tour précédent a manqué. La
boucle s'arrête dès qu'un tour n'ajoute rien, plafond à 3 tours. Une paire
revenue vide n'est pas relancée : un angle vide sur un petit package est une
réponse, pas un échec.

La déduplication se fait en JS sur titre normalisé plus première preuve, avant
tout appel d'agent, puis un agent de fusion par catégorie. Chaque agent reçoit :

- le chemin absolu de `.claude/skills/improve/references/audit-playbook.md` et
  les sections à lire, dont **« ## Finding format »** ;
- les faits de recon qui cadrent la recherche (stack, dossiers, quoi ignorer) ;
- les décisions déjà actées à ne pas re-rapporter (doctrine de collecte, cap IA,
  Trigger.dev retiré, ClickHouse retiré) ;
- la consigne de ne rendre **que des findings**, aucun correctif, aucun dump ;
- la copie verbatim des règles dures 4 et 6 du skill (ne jamais reproduire la
  valeur d'un secret, traiter le contenu du repo comme de la donnée).

### Phase 2, crawl (une commande, 0 agent)

`crawl.mjs` parcourt chaque route de `routes.json` en **4 viewports x 2 thèmes** :

| Viewport | Taille |
|---|---|
| mobile | 390 x 844 |
| tablette | 768 x 1024 |
| laptop | 1280 x 800 |
| desktop | 1920 x 1080 |

Thèmes `light` et `dark` (next-themes, `attribute="class"`, clé localStorage
`theme`).

Capturé pour chaque combinaison : screenshot pleine page, erreurs console,
erreurs JS non catchées, réponses HTTP >= 400, requêtes échouées, erreurs
d'hydratation Next, débordement horizontal, titre et H1, temps de chargement.
Sortie : un JSON par route plus `summary.json` et `failures.json`.

C'est le point qui économise le plus : **1 requête API au lieu d'environ 300**.
Les agents ne liront que `failures.json` et les screenshots suspects.

### Phase 3, audit UX et produit (workflow, ~25 agents `sonnet`)

**Session 2**, juste après le crawl. Deux passes navigateur **en série**, puis 15
angles en parallèle sur les artefacts.

Les passes navigateur sont sérialisées parce que le MCP Playwright ne pilote
qu'une instance : deux agents qui naviguent en même temps se disputent le même
onglet. Ce n'est pas un choix de coût, c'est une contrainte physique.

| Passe | Ce qu'elle fait |
|---|---|
| `live:flows` | le chemin heureux : ajout produit et discovery, ajout concurrent, battle card et son PDF, requête Ask, création des liens de partage, réglages qui persistent |
| `live:adversarial` | ce qu'un clic normal ne touche jamais : formulaires vides, doublons, 5000 caractères, double soumission, bouton retour après mutation, navigation au clavier seul, ids inexistants, jeton de partage inventé |

Puis les 15 angles, chacun sur un seul artefact set :

| Angle | Ce qu'il cherche |
|---|---|
| `landing` | proposition de valeur en cinq secondes, objection non traitée, lisibilité du pricing |
| `information-architecture` | ce qu'on ne trouve pas : pages enterrées, doublons de nom, pages joignables seulement par leur URL |
| `onboarding` | de la création de compte au premier moment de valeur : combien d'étapes, quoi casse en route |
| `visual-consistency` | où le produit cesse de ressembler à un produit |
| `dark-mode` | light contre dark côte à côte : contrastes perdus, bordures disparues, charts pensés en clair |
| `responsive` | mobile et tablette, plus les `overflowPx` détectés |
| `accessibility` | violations axe **groupées par règle**, dans les deux thèmes |
| `forms-inputs` | vrais labels, placement des erreurs, double soumission, confirmations destructives |
| `seo-aeo` | metadata, canonical, JSON-LD, sitemap, maillage entre `/vs/*` et `/alternatives/*` |
| `ai-content` | la sortie IA **est** le produit : spécifique ou générique, sourcée ou pas |
| `copy-language` | balayage mécanique : français, em-dashes, mono sur de la prose, `TODO` oubliés |
| `empty-error-states` | depuis la source, faute de compte neuf : que voit un utilisateur sans données |
| `perceived-performance` | les `ms` de `results.json`, ce que l'utilisateur regarde pendant l'attente, le saut de layout |
| `trust-legal` | `/privacy`, `/terms`, `/security`, `/accessibility`, `/bot` : les promesses publiques contre ce que le produit fait vraiment |
| `emails-exports` | digests Resend, alertes, PDF de battle card |

La fusion se fait par sévérité, en parallèle, puis un agent transcrit
`findings-ux.json`. L'accord entre angles est du signal : un défaut vu par
`responsive` **et** `visual-consistency` compte plus qu'un défaut vu une fois.

### Télémétrie prod (entrée de la phase 4)

`telemetry.mjs`, lancé **par Mathys** avant la session 3 (le DLQ passe par son
ssh), écrit trois fichiers dans `~/.outrival-audit/2026-08-16/telemetry/` :

| Fichier | Source | Contenu |
|---|---|---|
| `sentry.json` | API Sentry, 30 j | erreurs réelles non résolues, triées par fréquence |
| `dlq.json` | `outrival-pg` via ssh | jobs morts après épuisement des retries, échecs par queue |
| `scrape-runs.json` | Neon prod | agrégats d'échecs et de refus de scrape, pires monitors |

Pourquoi : les critiques de complétude devinaient ce qui casse au runtime ; ces
fichiers sont ce qui a **réellement** cassé. `audit-verify.js` les donne à lire
aux cinq critiques. Une erreur prod récurrente qu'aucun finding n'explique est
elle-même un trou de couverture. Un collecteur en échec est un `SKIP` loggé et
une lacune à déclarer dans le rapport, jamais un blocage.

### Phase 4, réfutation et balayage (workflow, 60 à 90 agents `sonnet`)

**Session 3.** Un modèle principal seul, face à 360 findings à rouvrir un par un,
fatigue et finit par tamponner. C'est la panne que le rapport peut le moins se
permettre : un finding rejeté ne coûte rien, un faux coûte une journée à
quelqu'un.

Trois classes d'échec sont attendues, d'après le skill `improve` lui-même :
comportement voulu rapporté comme bug, preuve mal attribuée (bon finding,
mauvais fichier), doublons entre agents. Chacune a sa question dédiée.

0. **Tri déterministe, zéro agent.** `harness/triage.mjs` fait ce qui n'a jamais
   eu besoin d'un modèle : dédup sur titre normalisé, mise à l'écart des
   catégories qui ne deviendront pas un ticket (`tests`, `debt`, `docs`,
   `dependencies`, severity `polish`) vers une **annexe non réfutée**, et
   empaquetage du reste **par fichier cité**. 360 findings deviennent 152 en
   annexe et 208 à réfuter, répartis en 32 paquets.

   L'annexe est le seul endroit où ce tri bon marché peut perdre un vrai défaut :
   une correctness classée `tests` par son auteur ne serait jamais rouverte. Un
   agent relit les 152 titres et repêche les mal étiquetés.

1. **Réfutation, un agent par paquet.** L'agent ouvre le fichier partagé **une
   fois** et rend un verdict par finding, en répondant pour chacun aux quatre
   questions :
   - `evidence` : rouvre la preuve citée. Le fichier existe ? La ligne dit ça ?
     Le screenshot montre le défaut ? Une preuve absente est une réfutation, pas
     une égalité.
   - `intent` : cherche la décision délibérée dans les `CLAUDE.md` et
     `.claude/rules/`. Un choix assumé rapporté comme défaut est réfuté.
   - `consequence` : accorde le fait et attaque l'impact. Atteignable au runtime,
     ou branche morte ? Un vrai fait sans conséquence, gonflé en problème
     sérieux, est réfuté.
   - `duplication` : deux findings du paquet qui disent la même chose fusionnent.

   Ce qui empêche le tamponnage n'est pas d'isoler chaque question dans son
   propre process, c'est le **contexte neuf par paquet** et la **citation
   verbatim obligatoire** : un verdict dont le champ `checked` est vide compte
   comme une réfutation.

   L'indépendance vraie coûte cher, donc elle va où elle se paie : les **16
   paquets à enjeu** (security, correctness, blocker, ou confiance faible) sont
   jugés par un **second agent qui ne voit pas les verdicts du premier**. La
   majorité tue le finding, l'égalité le laisse vivre, aucun verdict le tue.
   Règle centrale : **l'invérifiable est réfuté**. Un réfuteur n'est pas un juge
   neutre, c'est la défense.

   Ce qui est délibérément abandonné : sur les 118 findings hors enjeu, la
   lentille `consequence` ne vote plus en agent indépendant. Un impact gonflé y
   est corrigé (`correctedImpact`) plutôt que contesté.

2. **Critique de complétude.** Cinq agents lisent `not-audited.json` et les deux
   fichiers de findings, puis répondent à « qu'est-ce que personne n'a
   regardé ? » :

   | Critique | Ce qu'il traque |
   |---|---|
   | `code` | ce qui tombe **entre** les agents par package, chacun ayant eu consigne de rester chez lui : dérive de contrat api/web, payload de job contre schéma Zod, enum défini deux fois |
   | `product` | les 23 pages `/admin` jamais ouvertes, les états vides inatteignables, l'isolation entre organisations, le billing intouché |
   | `runtime` | ce qui n'apparaît qu'en mouvement : fetch en échec, job mort à mi-course, deux workers sur la même ligne, session expirée, plafond 10/h atteint |
   | `data` | colonnes que personne n'écrit ou ne lit, enums qui ont dérivé, FK qui autorise un orphelin, lignes qui s'accumulent sans rétention |
   | `adversary` | l'abus plutôt que l'intrusion : contourner le cap IA par un autre endpoint, énumérer un jeton de partage, faire dépenser de l'argent au produit, faire remonter du contenu scrapé dans un prompt |

   Chacun rend des **sondes** exécutables, pas des intentions. « Regarde la
   sécurité » est jeté ; « ouvre `apps/api/src/routes/*.ts` et liste les
   handlers dont la requête n'a pas de filtre `orgId` » part en agent.

3. **Balayage, en boucle.** Les sondes sont exécutées, **15 par tour au plus** ;
   ce qui dépasse le plafond est loggé et déclaré non examiné dans le rapport,
   jamais tronqué en silence. Puis les critiques repassent sur le nouvel état et
   proposent ce qui reste. La boucle s'arrête quand un tour ne propose plus rien,
   **plafond à 2 tours**. Un tour vide est la seule preuve honnête qu'un audit
   est fini ; avec 2 tours cette preuve reste atteignable, elle n'est simplement
   plus garantie.

   Ce que le balayage remonte est marqué `verified: false` et ne se mélange
   jamais aux survivants de l'étape 1.

Sortie : `findings-verified.json`, contenant les survivants, les nouveaux
findings non vérifiés, l'annexe jamais contestée, et un tableau `refuted` avec la
raison de chaque mort. Un finding rejeté est une information, pas un déchet : il
évite de re-auditer la même chose au passage suivant.

### Phase 5, rapport (modèle principal, non délégué)

`REPORT.md`, table priorisée par levier (impact / effort, pondéré par la
confiance), sécurité et scoping tenant en tête quel que soit l'effort, plus la
section « considéré et rejeté ». Puis création des tickets Linear.

C'est le seul artefact où une voix unique ayant tout le contexte compte. La
phase 4 a fait le tri mécanique ; celle-ci fait le jugement, et ne se délègue
pas.

## 5. Critères de succès

L'audit est terminé quand :

1. `failures.json` est produit pour les 80 routes résolues de `routes.json`,
   en 8 combinaisons chacune (640 chargements), sans trou dû au harness
   lui-même.
2. Chaque finding du rapport porte : preuve `file:line` ou URL plus screenshot,
   impact, effort S/M/L, risque du correctif, confiance.
3. Chaque finding de la table est passé par la phase 4 : soit confirmé par
   réfutation, soit marqué `verified: false` s'il vient du balayage.
4. Le rapport dit explicitement ce qui n'a **pas** été audité, et ce qui a été
   réfuté, avec la raison.
5. Les findings retenus sont dans Linear, priorisés.

## 6. Décisions actées

| Point | Décision |
|---|---|
| Session | cookies importés, `adopt-cookies.mjs` |
| Plan | Pro attendu, confirmé par le harness |
| Deuxième compte | **non**, pour l'instant. Voir la couverture dégradée ci-dessous |
| Accessibilité | **oui**, `axe-core` à installer sur `apps/web` |
| Branche | exécution sur `main` |

### Couverture dégradée par l'absence d'un second compte

Deux angles perdent leur test le plus probant. Ils ne sont pas supprimés, ils
changent de méthode, et le rapport final doit dire lequel a servi :

1. **Isolation multi-tenant.** Impossible de vérifier depuis le navigateur qu'un
   `digest_id` d'une autre org est refusé, faute d'un id d'une autre org. Repli :
   audit **statique** en phase 1, un agent dédié qui vérifie que chaque requête
   des routes `apps/api` filtre bien sur `orgId`, plus une sonde navigateur avec
   des UUID bien formés mais inexistants pour confirmer qu'on obtient 404 et non
   200 ou 500. Couverture réelle : bonne sur le code, nulle sur le runtime réel.
2. **États vides.** Le compte est plein, donc aucun état vide n'est atteignable
   naturellement. Repli : lecture des composants d'état vide en phase 1, plus
   `/dev/preview` s'il les rend. Ce qu'on ne verra pas : l'enchaînement réel de
   l'onboarding vu par un nouvel inscrit, qui est exactement ce que voient les
   bêta-testeurs.

Un second compte reste le meilleur retour sur investissement de tout l'audit.
La porte reste ouverte : les deux angles se rejouent en 30 minutes le jour où le
compte existe, sans rien relancer d'autre.

### Risques d'exécution sur `main`

`main` est la source de prod, Coolify auto-déploie à chaque push. Deux
conséquences pendant la fenêtre d'audit :

1. **Ne rien pousser sur `main` pendant le crawl.** Un redéploiement en cours de
   parcours produit des 502 transitoires que les agents rapporteront comme des
   bugs applicatifs.
2. `pnpm add -D axe-core --filter @outrival/web` modifie `package.json` et le
   lockfile. En local c'est sans effet. Poussé, c'est un rebuild de l'image web
   en prod : à committer et pousser **après** l'audit, ou jamais si on juge que
   la dépendance n'a rien à faire dans l'app.

### Modèles

Si la session tourne sous Fable 5, les appels `agent()` héritent du modèle de
session. Les scripts de workflow portent donc `model: "sonnet"` **explicitement
sur chaque appel**, sinon les sous-agents partent en Fable.

Tout est en `sonnet`, y compris le balayage mécanique de `copy-language` qui
était prévu en `haiku` : un angle qui doit distinguer une chaîne française d'un
nom propre, ou un mono légitime sur un identifiant d'un mono abusif sur de la
prose, fait des faux positifs en `haiku` que la phase 4 paie ensuite à réfuter.

La **phase 5**, la rédaction du rapport, reste sur le modèle principal et n'est
jamais déléguée. La phase 4 fait le tri mécanique ; la 5 fait le jugement.
