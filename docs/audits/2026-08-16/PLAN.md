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
| Modèle de vérification | modèle principal de session (Fable 5), jamais délégué |
| Modèles sous-agents | `sonnet` (découverte, jugement), `haiku` (inventaire, tri) |

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

### Phase 1, audit de code (workflow, 8 agents `sonnet`)

`improve deep` fanné par package : `web`, `api`, `workers`, `db`, `ai`,
`scrapers`, `queue`, `shared`. Chaque agent reçoit :

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

### Phase 3, audit UX et produit (workflow, ~10 agents)

Un agent par angle, tous en `sonnet` sauf mention :

| # | Angle | Ce qu'il fait |
|---|---|---|
| 1 | Landing et pricing, en « vrai utilisateur » | lit les screenshots, juge la proposition de valeur, les frictions, la clarté du pricing |
| 2 | Parcours compte plein | onboarding, ajout produit, discovery, génération battle card, bout en bout |
| 3 | Cohérence visuelle | compare les screenshots entre pages : espacements, typographies, états vides, boutons |
| 4 | Responsive | ne lit que les combinaisons mobile et tablette, plus les débordements détectés |
| 5 | Accessibilité | violations axe, ordre de tabulation, contrastes, `aria-label` |
| 6 | SEO et AEO | `/vs/*`, `/alternatives/*`, `/blog/*` : metadata, canonical, schema.org, sitemap |
| 7 | Qualité du contenu IA | insights, battle cards, digests : est-ce juste, sourcé, utile |
| 8 | Copy et langue (`haiku`) | traque les chaînes françaises, la casse, les micro-copies incohérentes |
| 9 | États vides et erreurs | pas de compte neuf : lecture des composants d'état vide plus les états d'erreur provoqués sur le compte réel |
| 10 | Emails et exports | `/dev/preview-emails`, PDF de battle card |

**Points ouverts sur cette phase, à trancher ensemble** (section 6).

### Phase 4, réfutation et balayage (workflow, ~45 agents `sonnet`)

Un modèle principal seul, face à 80 ou 120 findings à rouvrir un par un, fatigue
et finit par tamponner. La vérification est donc fanée, mais **bornée** : le
budget se compte en requêtes API, pas en tokens, et trois réfuteurs par finding
sur toute la liste videraient la fenêtre de 5 h pour rien.

Trois classes d'échec sont attendues, d'après le skill `improve` lui-même :
comportement voulu rapporté comme bug, preuve mal attribuée (bon finding,
mauvais fichier), doublons entre agents. Chacune a son objectif dédié.

1. **Réfutation.** Les findings à enjeu (sécurité, scoping tenant, perte de
   données, correctness, ou confiance faible) reçoivent **trois réfuteurs aux
   angles distincts** : `evidence` rouvre la preuve citée, `intent` cherche la
   décision délibérée dans les `CLAUDE.md` et `.claude/rules/`, `consequence`
   accorde le fait et attaque l'impact. Deux voix sur trois tuent le finding.
   Le reste part en lots de six chez un vérificateur unique.
   Règle centrale : **l'invérifiable est réfuté**. Un finding que personne n'a
   pu confirmer coûte une journée à quelqu'un pour rien.

2. **Critique de complétude.** Trois agents lisent les tableaux `notAudited` et
   répondent à « qu'est-ce que personne n'a regardé ? », sous trois angles : le
   code (ce qui tombe **entre** les agents par package, chacun ayant eu
   consigne de rester chez lui), le produit (les 23 pages `/admin`, les états
   vides, l'isolation entre organisations), et le runtime (ce qui n'apparaît
   qu'en mouvement : fetch en échec, job mort à mi-course, session expirée,
   plafond de 10 actions IA atteint). Chacun rend des **sondes** exécutables,
   pas des intentions.

3. **Balayage.** Les 8 premières sondes deviennent des agents chercheurs. Ce
   qu'elles remontent est marqué `verified: false` et ne se mélange jamais aux
   survivants de l'étape 1. Les sondes non exécutées sont **loguées**, jamais
   coupées en silence.

Sortie : `findings-verified.json`, contenant les survivants, les nouveaux
findings non vérifiés, et un tableau `refuted` avec la raison de chaque mort.
Un finding rejeté est une information, pas un déchet : il évite de re-auditer la
même chose au passage suivant.

### Phase 5, rapport (modèle principal, non délégué)

`REPORT.md`, table priorisée par levier (impact / effort, pondéré par la
confiance), sécurité et scoping tenant en tête quel que soit l'effort, plus la
section « considéré et rejeté ». Puis création des tickets Linear.

C'est le seul artefact où une voix unique ayant tout le contexte compte. La
phase 4 a fait le tri mécanique ; celle-ci fait le jugement, et ne se délègue
pas.

## 5. Critères de succès

L'audit est terminé quand :

1. `failures.json` est produit pour les 70 routes du périmètre navigateur, en 8
   combinaisons chacune, sans trou dû au harness lui-même.
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
session. Les scripts de workflow portent donc `model: "sonnet"` ou `"haiku"`
**explicitement sur chaque appel**, sinon les sous-agents partent en Fable.
La phase 4 reste sur le modèle principal, jamais déléguée.
