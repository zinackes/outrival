# Runbook — audit du 2026-08-16

Quoi lancer, quand, avec quel message. Le pourquoi est dans `PLAN.md`.

Trois sessions, dans l'ordre. Chacune part d'une **fenêtre neuve** (ou `/clear`),
à la racine du repo, sur `main`, **mode ultracode activé**. Elles se passent le
relais par les fichiers de `~/.outrival-audit/2026-08-16/`, jamais par le
contexte : tu peux couper entre deux, dormir, reprendre demain.

| | Session | Agents | Durée de calcul | Fenêtres de quota | Navigateur |
|---|---|---|---|---|---|
| ☐ | 1. code | 40 à 120 | 40 à 70 min | 1 à 2 | non |
| ☐ | 2. produit | ~25 | 50 à 70 min | 1 | **oui, sur la prod** |
| ☐ | 3. réfutation et rapport | 300 à 450 | 60 à 90 min | plusieurs | non |

Sessions 1 et 3 : bloquer sur la limite d'usage est **normal** (voir PLAN.md,
« Quota de requêtes »). Lancer en début de fenêtre ; à la limite, attendre la
fenêtre suivante et reprendre avec `resumeFromRunId`.

---

## Session 1 — code

Rien à préparer. Colle ça :

```
Audit Outrival 2026-08-16, session 1 sur 3: le code.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir. C'est la charte:
périmètre, garde-fous, ce qui est hors couverture. La phase 0 est faite et
validée: accès prouvé, plan Pro confirmé, 80 routes résolues.

Lance le workflow audit-code tel quel, sans le réécrire.

Quand il rend la main: résume-moi ce qu'il a écrit, et ne fais RIEN d'autre.
Pas de correctif, pas de vérification, pas de ticket. La session 3 s'en charge.
```

**Fini quand** `~/.outrival-audit/2026-08-16/findings-code.json` existe.
Suis l'avancement avec `/workflows`.

---

## Session 2 — produit

Lance-la quand tu peux laisser tourner sans pousser sur `main` pendant 1 h.

```
Audit Outrival 2026-08-16, session 2 sur 3: le produit.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir.

1. node docs/audits/2026-08-16/harness/crawl.mjs
   ~15 min, 640 chargements, strictement read-only. C'est un script, ne
   l'enrobe pas dans un workflow.

2. Lance le workflow audit-ux tel quel, sans le réécrire.

Ne pousse rien sur main pendant le crawl.

Quand il rend la main: résume, et rien d'autre.
```

**Fini quand** `findings-ux.json` existe et que la passe `live:flows` a remonté
les URLs de `/brief/<id>` et `/report/<token>`.

⚠️ **Cette session écrit dans ta vraie prod.** Un produit, un concurrent, une
battle card et son PDF, une requête Ask, un lien de partage. Des e-mails réels
partent. Jusqu'à 8 de tes 10 actions IA de l'heure sont consommées.
`/settings/danger` et `/settings/billing` restent interdits, Stripe est en LIVE.

⚠️ **Ne pousse pas `main` pendant le crawl.** Coolify auto-déploie, et un
redéploiement en cours de parcours produit des 502 que les agents rapporteraient
comme des bugs applicatifs.

---

## Session 3 — réfutation et rapport

Exige que les deux fichiers précédents existent.

```
Audit Outrival 2026-08-16, session 3 sur 3: réfutation et rapport.

Lis docs/audits/2026-08-16/PLAN.md en entier avant d'agir.

1. Lance le workflow audit-verify tel quel, sans le réécrire.

2. Écris docs/audits/2026-08-16/REPORT.md TOI-MEME. Ne le délègue à aucun
   sous-agent. Lis findings-verified.json, garde la distinction verified
   true/false, n'augmente la confiance de personne, et reprends la liste
   refuted telle quelle dans une section "considéré et rejeté".

3. Propose les tickets Linear, ne les crée pas avant mon go.

Critère de succès: REPORT.md existe; chaque finding porte sa preuve (file:line
ou URL plus screenshot), son impact, son effort S/M/L, le risque du correctif,
sa confiance et son statut vérifié ou non; la section "considéré et rejeté"
donne la raison de chaque réfutation; et le rapport dit explicitement ce qui n'a
pas été audité.
```

**Fini quand** `docs/audits/2026-08-16/REPORT.md` existe.

---

## Après

☐ Révoquer la session utilisée, dans **Settings puis Security**. Le jeton a
transité par une conversation.

☐ Décider du sort de `axe-core` : committé en devDependency de `apps/web`, non
poussé. Le pousser rebuild l'image web en prod.

☐ Créer les tickets Linear validés.

---

## Si ça coince

**Le crawl boucle sur `/auth`.** La session est morte, le cookie expire vers le
2026-09-15. Réexporter les cookies et rejouer
`node docs/audits/2026-08-16/harness/adopt-cookies.mjs`.

**Un workflow meurt en route, ou « usage limit reached ».** Attendu sur les
sessions 1 et 3. Le workflow a écrit son script sous le dossier de session et
rendu un `runId` : relancer avec `resumeFromRunId` (à la fenêtre suivante si
c'est le quota), le préfixe déjà exécuté revient du cache sans recoûter.

**Une session dit `networkidle`.** Elle réintroduit un bug déjà corrigé :
`networkidle` ne se déclenche jamais sur une page authentifiée, parce que
`notifications-bell.tsx` ouvre un `EventSource` dans le shell du dashboard.
`settle.mjs` attend la disparition des `data-slot="skeleton"` à la place.

**Trois findings sont déjà connus** depuis le smoke, à confirmer et non à
recopier : hydratation React #418 sur `/dashboard/activity`, débordement
horizontal de 55 px à 768 px, violations axe `button-name` et `color-contrast`
dans le shell.
