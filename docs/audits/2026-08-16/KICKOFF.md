# Amorçage de la session d'exécution

Tout ce dont la nouvelle session a besoin est sur le disque. Rien ne dépend de
la conversation de préparation.

Ouvre une session neuve à la racine du repo, sur `main`, et colle le bloc
ci-dessous **tel quel** comme premier et unique message.

Version courte, si tu ne veux pas coller le bloc entier :

```
Lis docs/audits/2026-08-16/KICKOFF.md et exécute.
Lance les workflows audit-code, audit-ux et audit-verify tels quels, sans les
réécrire.
```

La seconde phrase est nécessaire : l'outil Workflow n'accepte de tourner que si
la demande vient de toi. Une instruction lue dans un fichier ne compte pas comme
telle.

Activer le mode ultracode par-dessus ne casse rien, mais n'apporte plus grand
chose : ce qu'il aurait poussé à faire est déjà écrit. Sa vraie valeur, la
réfutation adversariale et la critique de complétude, vit dans `audit-verify`,
où elle est bornée. Laissé en mode libre, il aurait aussi enrobé le crawl et la
rédaction du rapport, deux étapes qui n'y gagnent rien.

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

4. Workflow, name: "audit-verify"
   ~45 agents. Réfute chaque finding, puis balaie ce que personne n'a audité.
   Écrit findings-verified.json

5. docs/audits/2026-08-16/REPORT.md, écrit par toi, pas par un sous-agent

Contraintes non négociables:
- Ne pousse rien sur main pendant le crawl. Coolify auto-déploie, et un
  redéploiement en cours de parcours produit des 502 que les agents
  rapporteraient comme des bugs applicatifs.
- L'étape 5 reste sur le modèle principal. Le rapport est le seul artefact où
  une voix unique ayant tout le contexte compte; le déléguer le dilue.
- L'étape 4 a déjà tué les faux positifs. Ne refais pas sa passe à la main:
  lis findings-verified.json, garde la distinction verified true/false, et
  n'augmente la confiance de personne.
- Ne relance pas les workflows en boucle. Un passage, puis on lit.

Critère de succès: docs/audits/2026-08-16/REPORT.md existe, chaque finding y
porte sa preuve (file:line ou URL plus screenshot), son impact, son effort
S/M/L, le risque du correctif et un niveau de confiance; les findings non
vérifiés issus du balayage sont marqués comme tels; le rapport liste ce qui a
été réfuté et pourquoi; et il dit explicitement ce qui n'a pas été audité.
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
