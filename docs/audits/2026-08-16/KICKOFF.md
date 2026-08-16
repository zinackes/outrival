# Amorçage des sessions d'exécution

Tout ce dont l'exécution a besoin est sur le disque. Rien ne dépend de la
conversation de préparation.

L'audit tourne en **trois sessions**, dans cet ordre. Chacune part d'un `/clear`
ou d'une fenêtre neuve, à la racine du repo, sur `main`. Elles communiquent par
les fichiers de `~/.outrival-audit/2026-08-16/`, jamais par le contexte.

Découper n'est pas une concession au budget, c'est ce qui rend l'exhaustivité
possible : une session unique passerait la moitié de l'audit au-dessus de 200k de
contexte, où chaque tour est refacturé et où la compaction commence à effacer
les artefacts au moment précis où on en a besoin.

| Session | Contenu | Agents | Durée | Navigateur |
|---|---|---|---|---|
| 1 | `audit-code` | 40 à 120 | 40 à 70 min | non |
| 2 | `crawl.mjs` puis `audit-ux` | ~25 | 50 à 70 min | oui, sur la prod |
| 3 | `audit-verify` puis `REPORT.md` | 300 à 450 | 60 à 90 min | non |

**Le mode ultracode est utile ici**, contrairement à ce qui était noté avant. Il
ne change pas les workflows, qui sont écrits et paramétrés, mais il lève
l'hésitation par défaut à lancer une orchestration lourde, et c'est exactement ce
qu'on veut sur les trois. Ce qu'il faut surveiller : qu'il n'enrobe pas le crawl
(un script déterministe) ni la rédaction du rapport (voir session 3).

---

## Session 1 — code

```
Audit Outrival 2026-08-16, session 1 sur 3: le code.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir. C'est la charte:
périmètre, garde-fous, ce qui est hors couverture. La phase 0 est faite et
validée: accès prouvé, plan Pro confirmé, 80 routes résolues.

Lance le workflow audit-code tel quel, sans le réécrire.

Il fait tourner 8 packages x 5 angles de lecture, puis reboucle sur les paires
qui ont produit quelque chose, en leur disant ce qui est déjà trouvé, jusqu'à
ce qu'un tour n'ajoute plus rien. Il écrit findings-code.json.

Quand il rend la main: résume-moi ce qu'il a écrit, et ne fais RIEN d'autre.
Pas de correctif, pas de vérification, pas de ticket. La session 3 s'en charge.
```

## Session 2 — produit

```
Audit Outrival 2026-08-16, session 2 sur 3: le produit.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir.

1. node docs/audits/2026-08-16/harness/crawl.mjs
   ~15 min, 640 chargements, strictement read-only. C'est un script, ne
   l'enrobe pas dans un workflow. Produit failures.json, results.json et les
   screenshots dans ~/.outrival-audit/2026-08-16/

2. Lance le workflow audit-ux tel quel, sans le réécrire.
   Deux passes navigateur en série (le MCP ne pilote qu'une instance), puis 15
   angles en parallèle. Écrit findings-ux.json.

Ne pousse rien sur main pendant le crawl. Coolify auto-déploie, et un
redéploiement en cours de parcours produit des 502 que les agents rapporteraient
comme des bugs applicatifs.

Quand il rend la main: résume, et rien d'autre.
```

## Session 3 — réfutation et rapport

```
Audit Outrival 2026-08-16, session 3 sur 3: réfutation et rapport.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir.

1. Lance le workflow audit-verify tel quel, sans le réécrire.
   Il réfute chaque finding sous 2 ou 3 angles adverses, puis fait tourner 5
   critiques de complétude et balaie leurs sondes, en rebouclant jusqu'à ce
   qu'un tour ne propose plus rien de neuf. Écrit findings-verified.json.

2. Écris docs/audits/2026-08-16/REPORT.md TOI-MEME. Ne le délègue à aucun
   sous-agent: c'est le seul artefact où une voix unique ayant tout le contexte
   compte, et la phase 1 a déjà fait le tri mécanique.
   Lis findings-verified.json, garde la distinction verified true/false,
   n'augmente la confiance de personne, et reprends la liste refuted telle
   quelle dans une section "considéré et rejeté".

3. Propose les tickets Linear, ne les crée pas avant mon go.

Critère de succès: REPORT.md existe; chaque finding porte sa preuve (file:line
ou URL plus screenshot), son impact, son effort S/M/L, le risque du correctif,
sa confiance et son statut vérifié ou non; la section "considéré et rejeté"
donne la raison de chaque réfutation; et le rapport dit explicitement ce qui n'a
pas été audité.
```

---

## Rappels

**Accès.** La session est authentifiée via `state.json`, écrit à partir de
cookies exportés du navigateur. Le cookie expire aux alentours du 2026-09-15. Si
le crawl part en boucle de redirections vers `/auth`, la session est morte :
rejouer `adopt-cookies.mjs` avec un export frais.

**Le piège déjà désamorcé.** `networkidle` ne se déclenche jamais sur une page
authentifiée, parce que `notifications-bell.tsx` ouvre un `EventSource` dans le
shell du dashboard. `settle.mjs` attend la disparition des
`data-slot="skeleton"` à la place. Ne pas le réintroduire.

**Ce que le smoke a déjà trouvé**, sur 2 routes seulement, à confirmer et non à
recopier tel quel :
- erreur d'hydratation React #418 sur `/dashboard/activity`, sur les 8
  combinaisons ; hypothèse à vérifier, un rendu de date serveur contre client ;
- débordement horizontal de 55 px à la largeur tablette de 768 px ;
- violations axe `button-name` et `color-contrast`, probablement dans le shell,
  donc à grouper par règle et non par page.

**Deux routes n'existent pas encore.** `/brief/[id]` et `/report/[token]`
n'apparaissent qu'une fois un partage créé. C'est la première passe navigateur
de la session 2 qui les crée, étape 5 de son prompt, et qui doit remonter leurs
URLs.

**La session 2 écrit dans ta vraie prod.** Un produit, un concurrent, une battle
card et son PDF, une requête Ask, un lien de partage. Des e-mails réels partent.
Jusqu'à 8 des 10 actions IA de l'heure sont consommées. `/settings/danger` et
`/settings/billing` restent interdits, Stripe est en LIVE.

**Après l'audit.** Révoquer la session utilisée, dans Settings puis Security.
Le jeton a transité par une conversation.
