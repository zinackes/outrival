# Amorçage de la session d'exécution

Tout ce dont la nouvelle session a besoin est sur le disque. Rien ne dépend de
la conversation de préparation.

Ouvre une session neuve à la racine du repo, sur `main`, et colle le bloc
ci-dessous **tel quel** comme premier et unique message.

Version courte, si tu ne veux pas coller le bloc entier :

```
Lis docs/audits/2026-08-16/KICKOFF.md et exécute.
Lance les workflows audit-code et audit-ux tels quels, sans les réécrire.
```

La seconde phrase est nécessaire : l'outil Workflow n'accepte de tourner que si
la demande vient de toi. Une instruction lue dans un fichier ne compte pas comme
telle. Inutile en revanche d'activer le mode ultracode globalement : il pousse à
enrober **chaque** tâche dans un workflow, y compris le crawl et la vérification,
qui n'en ont pas besoin.

---

```
Audit Outrival 2026-08-16 — exécution
Type: audit
Mode: direct, pas de plan mode

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir. C'est la charte:
périmètre, garde-fous, ce qui est hors couverture. La phase 0 est déjà faite et
validée: accès prouvé, plan Pro confirmé, 80 routes résolues.

Exécute dans cet ordre, en me rendant la main entre chaque étape:

1. node docs/audits/2026-08-16/harness/crawl.mjs
   ~15 min, 640 chargements, strictement read-only.
   Produit failures.json, results.json et les screenshots dans
   ~/.outrival-audit/2026-08-16/

2. Workflow, name: "audit-code"
   9 agents. Écrit ~/.outrival-audit/2026-08-16/findings-code.json

3. Workflow, name: "audit-ux"
   11 agents, dont un seul pilote le navigateur. Écrit findings-ux.json

4. Vérification, puis docs/audits/2026-08-16/REPORT.md

Contraintes non négociables:
- Ne pousse rien sur main pendant le crawl. Coolify auto-déploie, et un
  redéploiement en cours de parcours produit des 502 que les agents
  rapporteraient comme des bugs applicatifs.
- L'étape 4 reste sur le modèle principal. Ne la délègue à aucun sous-agent:
  les agents sur-rapportent, et un rapport avec 15 faux findings sur 40 vaut
  moins qu'un rapport de 20 vrais.
- Ne relance pas les workflows en boucle. Un passage, puis on lit.

Critère de succès: docs/audits/2026-08-16/REPORT.md existe, chaque finding y
porte sa preuve (file:line ou URL plus screenshot), son impact, son effort
S/M/L, le risque du correctif et un niveau de confiance; chaque finding de la
table a été rouvert et confirmé; et le rapport dit explicitement ce qui n'a pas
été audité.
```

---

## Rappels pour la session d'exécution

**Ce qui est déjà fait.** La session est authentifiée via `state.json`, écrit à
partir de cookies exportés du navigateur. Le cookie expire aux alentours du
2026-09-15. Si le crawl part en boucle de redirections vers `/auth`, c'est que
la session est morte: rejouer `adopt-cookies.mjs` avec un export frais.

**Le piège déjà désamorcé.** `networkidle` ne se déclenche jamais sur une page
authentifiée, parce que `notifications-bell.tsx` ouvre un `EventSource` dans le
shell du dashboard. `settle.mjs` attend la disparition des
`data-slot="skeleton"` à la place. Ne pas réintroduire `networkidle`.

**Ce que le smoke a déjà trouvé**, sur 2 routes seulement, à confirmer et non à
recopier tel quel :
- erreur d'hydratation React #418 sur `/dashboard/activity`, sur les 8
  combinaisons; hypothèse à vérifier, un rendu de date serveur contre client;
- débordement horizontal de 55 px à la largeur tablette de 768 px;
- violations axe `button-name` et `color-contrast`, probablement dans le shell,
  donc à grouper par règle et non par page.

**Deux routes restent à créer.** `/brief/[id]` et `/report/[token]` n'existent
qu'une fois un partage créé. C'est l'agent navigateur de `audit-ux` qui s'en
charge, étape 5 de son prompt.

**Après l'audit.** Révoquer la session utilisée, dans Settings puis Security.
Le jeton a transité par une conversation.
