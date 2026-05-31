# R2 storage — axe d'optimisation

> Statut : **à décider** (note de réflexion, pas encore d'implémentation).
> Date : 2026-05-31. Source : audit du flux `scrape-monitor.job.ts` + libs R2.

## Contexte

À terme le stockage R2 croît de façon non bornée. Question initiale : « ça va
prendre masse de GB ? ». Réponse courte : oui (~100+ GB/an cumulatif à l'échelle
~50 orgs), mais le coût $ reste faible — le vrai sujet est l'**hygiène / croissance
non bornée**, pas le budget.

## Ce qui est DÉJÀ optimisé (ne pas retoucher)

Le write-side dédup déjà au hash : `scrape-monitor.job.ts:95-113`. Si le contenu
n'a pas changé (`lastSnapshot.contentHash === newHash`), **aucun** upload R2 ni
insert snapshot — juste un reschedule. Donc on ne stocke qu'aux **vrais
changements**, pas à chaque poll. Pas de doublons de polls à chasser.

## Ce qui est stocké et qui le relit

| Objet | Écrit quand | Relu par |
|---|---|---|
| `{key}.html` | à chaque changement de contenu | `extract-*` (snapshot courant) + diff (snapshot **N-1** uniquement, `scrape-monitor.job.ts:139`) |
| `{key}.png` | si `screenshotBuffer.length > 0` (`scrape-monitor.job.ts:119`) | **personne** — aucun `getFromR2` ne lit `.png` |
| `battle-cards/*.pdf` | à chaque (re)génération | servi via `battle_cards.pdf_r2_key` ; les anciens deviennent orphelins |

Trois constats qui pèsent :

1. **Aucune rétention nulle part.** Pas de lifecycle R2, pas de `DeleteObject`,
   pas de prune (vérifié par grep : 0 occurrence). Tout l'historique s'accumule à
   vie. Or le pipeline n'a jamais besoin que du **dernier snapshot par monitor**
   (pour differ le suivant). Tout ce qui est ≥ N-2 est de l'archive froide sans
   aucun lecteur actuel.
2. **HTML stocké brut, non compressé.** Du HTML gzip à ~85%.
3. **Les screenshots PNG sont write-only.** Rien ne les lit aujourd'hui — stockés
   pour les diffs visuels Phase 8 qui n'existent pas encore. Un PNG full-page
   (~0.5–1.5 MB) pèse plus lourd que le HTML → probablement le 1er poste de
   stockage, pour zéro usage actuel.

## Volumétrie estimée (≈50 orgs)

~1600 monitors. Le stockage croît au rythme des **changements détectés**, pas des
scrapes. Hypothèse ~4 changements/mois/monitor :

```
6 400 changements/mois × (HTML ~0.5 MB + PNG ~1 MB) ≈ 9–10 GB/mois
                                                     ≈ ~115 GB/an, cumulatif
```

Coût R2 : ~$0.015/GB/mois, pas d'egress → ~$2/mois an 1, croissance linéaire à vie.
Donc : pas un problème de budget, un problème de croissance non bornée + ~70% des
octets (PNG) inutiles aujourd'hui.

## Leviers, classés impact/effort

1. **Arrêter de capturer les PNG (ou les différer Phase 8).** Supprime le plus gros
   poste pour zéro perte fonctionnelle. Si on veut les garder pour Phase 8 :
   JPEG/WebP qualité ~70 (~5–8× plus léger) au lieu de PNG.
   *Effort : ~3 lignes `scrape-monitor.job.ts` + le scraper.*
2. **Job de prune (rétention applicative).** Supprime de R2 tous les snapshots sauf
   les N derniers par monitor (ou > X jours **en gardant le dernier**, requis par le
   diff). Un lifecycle R2 pur-âge ne suffit pas : il pourrait expirer le dernier
   snapshot d'un monitor lent/pausé → diff cassé. Cron hebdo applicatif plus sûr.
   Inclut le cleanup à la suppression de competitor (`deleted_at` → blobs jamais
   nettoyés aujourd'hui). *Effort : nouveau `prune-snapshots.job.ts`.*
3. **Gzip du HTML avant upload.** `ContentEncoding: gzip`, ~5–7× sur la part HTML.
   *Effort : petit changement dans `uploadToR2`/`getFromR2`.*
4. **Lifecycle R2 sur `battle-cards/`.** Expiry court (anciens PDF déjà orphelins
   dès régénération). *Effort : config dashboard/wrangler, zéro code.*

## Reco

Ordre de valeur : **#1 (PNG) → #2 (prune) → #3 (gzip)**. #1 et #3 ≈ 10 lignes
chacun ; #2 = petit job. Ensemble : croissance non bornée ~115 GB/an → quelques GB
stables.

## Décision en attente

- [ ] **Screenshots** : on les garde pour Phase 8 (→ WebP) ou on coupe (→ supprimer
  la capture) ? Tranche si #1 = "supprimer" ou "passer en WebP".
- [ ] Implémenter #1 + #3 (quick wins surgicaux) maintenant ?
- [ ] Cadrer le job de prune #2 (politique : N derniers vs âge + garde-dernier).
