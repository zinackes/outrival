# Progress Log — Outrival

Log chronologique des sessions de développement.

## Format

### [DATE] — [Phase] — [Durée estimée]
**Objectif** : ...
**Réalisé** :
- ...
**Fichiers modifiés** :
- ...
**Tests** : pnpm build ✓ | pnpm typecheck ✓ | tests ✓
**Prochaine session** : ...

---

## Sessions

## Véracité Intelligence v2 — P1 : complétude des captures, gardes unifiées, R6 (2026-08-05)

**Le constat, corrigé.** La card annonçait « R1 (complétude + partial) pas encore
implémenté ». C'est faux depuis une itération antérieure : `snapshot_status` porte déjà
`partial`, `apps/workers/src/lib/completeness.ts` gradait déjà les captures, et
`extractionAllowed`/`skipDiffForPartial` étaient déjà câblés. P1 n'a donc pas construit
R1 de zéro — il a fermé les trous que la version booléenne laissait ouverts.

**Le trou principal était la baseline.** `lastSnapshot` ne filtrait pas le statut. Un
snapshot `partial` devenait donc la référence du run suivant : son `contentHash`
court-circuitait la capture saine d'après en « no change » (le vrai changement était
masqué), et son contenu était le côté « avant » de tous les diffs. La requête exclut
maintenant `partial`, ce qui règle les deux d'un coup pour toutes les branches de diff
au lieu de garder chacune. `hasAnySnapshot` isole la question « ce monitor a-t-il déjà
capturé quoi que ce soit » pour les effets one-shot (backfill archive) qui ne doivent
pas re-tirer parce que la première capture était partielle.

**Le score remplace le booléen.** `@outrival/scrapers/completeness` est un module PUR :
`computeCompleteness({textLength, historicalMedian, sourceType, anchorsFound, httpStatus,
renderLevelReached, renderLevelExpected})` → `{score 0-1, reasons[]}`, scoring soustractif
(1.0 moins une pénalité NOMMÉE par check raté) pour qu'un score se relise toujours comme
« quels checks ont échoué ». Seuils en constantes commentées (`PARTIAL_SCORE_THRESHOLD`
0.6, `MEDIAN_RATIO_FLOOR` 0.5, `DEAD_BAND_MIN/MAX` 100-600). Ancres attendues par source
(`EXPECTED_ANCHORS` : pricing = ≥1 montant OU indicateur de modèle · jobs = ≥1 posting OU
état vide EXPLICITE · homepage = ≥1 titre), plus `countCaptureAnchors` pour les compter.
Le homepage compte son ancre via `isIncompleteRender` et non la regex : un rendu SPA raté
émet quand même des titres. `SNAPSHOT_COMPLETENESS_MIN_RATIO` disparaît — un seuil
calibré sur fixtures n'est pas une var d'env.

**Le contrat `partial`, complété.** Il ne devient jamais la baseline (ci-dessus), ne
déclenche aucune extraction (déjà là), ne reset PLUS les compteurs d'échec — et ne les
incrémente pas non plus : trois partials d'affilée ne peuvent pas atteindre
`markedUnscrapable`, parce qu'auto-pauser une source qui NOUS RÉPOND est exactement le
mode de panne T4. Au 3ᵉ partial consécutif, un log structuré `event: "source_degraded"`
pour la page Sources. `logScrapeRun` garde délibérément `status: "success"` : ~8 lecteurs
SQL (feed d'activité, /admin, status public, recap mensuel) bucketisent sur cette chaîne
exacte, et la scinder est un changement à part avec son propre audit. Le verdict honnête
vit sur `snapshots.status` / `snapshots.completeness`, là où le pipeline le lit.

**R6.** `classifyRedirect(intended, final)` remplace `isOffsiteRedirect` sur le chemin
succès : `offsite` (autre domaine enregistrable) et `root_bounce` (un chemin à segments
atterrit sur la racine nue — la page monitorée n'existe plus et le site nous renvoie à
l'accueil). Un préfixe de locale n'est PAS un écart : c'est la même page, localisée, et
la flaguer silencierait tout monitor dont le site géo-redirige. Une section renommée non
plus — le verdict collerait pour toujours puisque l'URL du monitor ne bouge jamais. Mur
de consentement ajouté à `detectDenyPage` (copie ET contrôle accept/reject, sous la même
porte des 3000 chars : un bandeau ne rend jamais une page courte). Bande soft-block
élargie de 100 à `SOFT_BLOCK_TEXT_BAND` = 600 via `isSoftBlockShell`, extrait en pur pour
être calibré sur fixtures : la bande n'est qu'un DÉCLENCHEUR, le verdict reste le
cross-check markup (cheerio, sans CSS calculé), qui est ce qui rend l'élargissement sûr.

**R4/R5 par unification.** `protectRegression({prevCount, nextCount, minPrev, minKeep})`
dans `@outrival/shared`. `minPrev` s'ajoute à la signature de la card parce que sans lui
1 → 0 serait « protégé », c'est-à-dire qu'une vraie suppression du dernier tier serait
supprimée. Les deux gardes existantes deviennent des usages, comportement identique,
tests conservés : pricing (`minPrev 3, minKeep 2` + corroboration harvest) et
entitlements (`minPrev 5, minKeep keepRatio(prev, 0.3)`). La garde jobs n'a PAS été
convergée : sa règle est catégorielle (`authoritative`), pas une régression de compte —
la forcer dans le moule aurait changé son comportement. Nouvelle règle à la place, dans
les deux extracteurs : un batch issu d'un snapshot `partial` est REJETÉ (log, pas
d'exception), défense en profondeur pour les chemins que scrape-monitor ne garde pas
(re-scan forcé, re-run admin, retry).

**T6 fermé.** L'anti-void ne throw plus. Il throwait, donc la page vidée n'était JAMAIS
stockée, donc elle ne pouvait pas devenir son propre précédent : chaque run re-throwait,
trois échecs marquaient la source unscrapable, et le signal « ils ont vidé leur page »
n'était jamais capturé. Le throw n'achetait qu'une chose — empêcher un soft-block de
devenir la baseline — et `partial` l'achète désormais sans le deadlock. `checkAntiVoid`
gagne `opts.lastSize` (taille de la dernière capture QUEL QUE SOIT son statut) : la
médiane doit rester bâtie sur les captures complètes, mais « cette réduction a-t-elle
déjà persisté » doit voir la capture dégradée. Run 1 → partial ; run 2 →
`stable_smaller_content` → le CHANGE est capturé.

**Provenance** (migration `0075`, tout nullable, legacy intouché) : `completeness`,
`capture_method` (`static|rendered|feed|api`, généralisation du vocabulaire de
`price_points.method`), `observed_region`, `final_url`, `http_status`. Écrits au fil de
l'eau sur chaque snapshot, zéro backfill.

**Tests** : `pnpm typecheck` ✓ (8/8) · shared 869 ✓ · scrapers 1145 ✓ · workers 357 ✓ ·
api 374 ✓ · web 204 ✓ · ai 214 ✓ · db 5 ✓ — 3168 au total, 0 fail. **Zéro appel IA
ajouté** (aucun fichier neuf n'importe `@outrival/ai`, aucun fichier de `packages/ai`
touché), **zéro nouveau signal**. Périmètre du plan 028 (diff/scoring/significance)
intouché — vérifiable au `git status`. Plan 029 déjà DONE en code, donc non ré-exécuté.

**Écart assumé vs le brief** : `final_url` porte aujourd'hui la même valeur que
`resolved_url`. Les deux sont gardées séparées parce que `resolved_url` appartient au
scraper (une source la réécrit pendant sa propre découverte de chemin) alors que
`final_url` est la trace worker de l'URL contre laquelle l'assertion R6 a été évaluée —
sans quoi un scraper qui se met à réécrire `resolved_url` réécrit rétroactivement la
preuve derrière chaque verdict de redirection passé. C'est la seule des cinq colonnes
qui est redondante à date.

**Reste côté humain** :
- **Migration `0075_pink_calypso.sql` à appliquer** (additive, 5 colonnes nullable) —
  staging d'abord, puis prod. Vérifier les migrations PENDING avant tout `db:migrate`
  sur un env partagé.
- Retirer `SNAPSHOT_COMPLETENESS_MIN_RATIO` de `/opt/outrival/.env.worker` (plus lue).
- Déployer workers (le contrat `partial` et la bande soft-block sont worker-side ; un CI
  vert ne les rend pas vivants — il faut rebuild l'image et redémarrer les deux services).
- **Surveiller le taux de `partial` après déploiement.** La bande soft-block passe de 100
  à 600 chars et le dead band grade `partial` : si un type de source part en partial en
  masse, c'est une calibration à revoir, pas un incident — `SNAPSHOT_COMPLETENESS_ENABLED=false`
  reste le kill-switch (il ne désarme PAS l'anti-void, volontairement).
- P2 à P5 (double-capture, grounding réel, preuve visible, porte faithfulness) NON
  entamées — 1 phase = 1 session.

## Véracité Intelligence v2 — P2 : double-capture, rétention silencieuse, ab_test_suspected (2026-08-05)

**Le point d'interception, corrigé.** La card désigne `severity-guard.ts` comme « LE point
d'interception ». Ce n'est pas vrai : `applySeverityGuard` n'a qu'un seul appelant. Mais il
est appelé DANS `generate-signal.ts`, et c'est là que se trouve la vraie frontière — la
seule insertion `signals` de tout le code de production (les ~20 émetteurs, classifieur IA
comme détecteurs déterministes, y convergent tous via la queue). L'interception vit donc là,
juste APRÈS la garde de sévérité (la sévérité lue est celle qui sera écrite) et juste AVANT
l'appel insight. Hors périmètre, c'est une lecture indexée et le run continue exactement
comme avant P2.

**Zéro appel IA ajouté, littéralement.** Un signal différé n'a pas encore coûté un token :
`interceptEmission` rend la main avant `generateInsight`. À la confirmation, generate-signal
est ré-enfilé avec LE MÊME payload et produit son insight à ce moment-là. L'appel est
DÉPLACÉ, jamais doublé, et la classification n'est jamais rejouée. Aucun des six fichiers
neufs n'importe `@outrival/ai` (vérifiable au grep).

**Le périmètre est une propriété de la CAPTURE, pas une liste d'exceptions.** `capture_method`
(provenance P1) fait le tri tout seul : seuls `static` et `rendered` sont rejouables. Les
signaux dérivés de données agrégées (hiring_shift, review_shift, salary_band_shift,
ai_visibility_shift) et tous les anchors synthétiques ont un `capture_method` NULL parce
qu'aucune page n'a été fetchée — ils sont exempts par construction, sans liste à maintenir.
S'ajoutent `partial` (P1 : une capture déjà connue comme dégradée ne se fait pas vouchée par
une seconde) et l'absence d'URL. Puis seulement : critical toutes sources, high sur
`VOLATILE_SOURCES` = pricing + homepage. Un medium/low n'est JAMAIS différé.

**Le délai EST le mécanisme.** Quick check à T+2 min (`QUICK_CHECK_DELAY_MIN`) : tue le
transitoire — rendu à moitié fini, page d'erreur servie dix secondes. Capture indépendante à
T+30 (`VERIFY_DELAY_MIN`, compté depuis la détection) : un re-fetch immédiat relit le même
objet CDN (TTL en minutes), le même bucket A/B (bucketing par IP), le même déploiement en
cours — il ne peut qu'être d'accord avec le premier. Deux fetches par change, jamais trois :
`retryLimit: 0` sur la queue rend la politesse littérale au lieu de la promettre.

**Ce qui est comparé : le DELTA, pas la page.** `@outrival/shared/verification-delta` est
PUR. `buildDeltaProof` sort ≤3 extraits par côté (normalisés casse+espaces, tronqués à 160,
plancher de 8 chars — matcher « 12 » ne prouve rien) et un `fingerprint` stable au tri.
`checkDeltaAgainst` exige les ajouts PRÉSENTS **et** les retraits ABSENTS : la seconde moitié
est celle qui attrape le flip A/B, où l'ancienne variante revient et la page contient
maintenant l'avant ET l'après d'un changement qui n'a pas eu lieu. `parseExcerpts` relit le
blob stocké : le job vérifie les extraits ENREGISTRÉS, pas des extraits re-dérivés 30 min
plus tard (toute dérive entre les deux dérivations changerait silencieusement ce qui est
vérifié).

**`skipped` n'a jamais retenu un signal.** Même posture que `faithfulness/gate.ts`. Refus,
timeout, 404, capture gradée `partial` par le grader P1, méthode de capture différente de
l'originale (un `static` re-capturé au navigateur est un autre document), et jusqu'aux bugs
du vérificateur lui-même : chacun écrit `outcome='skipped'` et ÉMET. Un signal déjà jugé
digne d'être envoyé ne disparaît pas parce que NOTRE scraper a échoué. Test dédié : 403 →
signal émis.

**Non-reproduit = silence.** Pas d'alerte « non vérifié », pas de signal dégradé : le
prochain scrape re-détectera si c'était réel. La rétention est logguée et la ligne
`signal_verifications` reste, parce qu'elle est ce que compte le détecteur A/B.

**Anti-flap.** À l'interception, si le fingerprint du change — ou son INVERSE — matche un
`not_reproduced` des 14 derniers jours sur le même monitor, le change part en vérification
même si sa sévérité seule ne le déclencherait pas. L'override ne franchit PAS le test
capture-live : une page qu'on ne peut pas re-fetcher ne peut pas être vérifiée, et l'y router
échouerait son signal pour toujours (test dédié). L'extraction et l'historique continuent
d'écrire ce qu'ils observent — l'historique reflète les variantes, c'est honnête.

**`ab_test_suspected`.** Le seul signal AJOUTÉ par la phase, entièrement fait de signaux
qu'elle a retenus. ≥2 `not_reproduced` (même delta ou inverse) en 14 j sur la même page →
une émission, cooldown 30 j par monitor. MEDIUM sur pricing, LOW ailleurs ; catégorie
`pricing` ou `content` — l'enum n'est PAS étendu. Ancré sur un `page_variance` dédié
(`isActive: false`, pattern `hiring_salary` / `pricing_probe`), pas sur le monitor qui flappe :
cette chaîne-là est ce que le dédup content-hash diffe à la capture SUIVANTE, et le change
concerné porte déjà une vérification dont le verdict est « ne pas émettre celui-ci ». Le
payload porte `skipVerification: true` — un signal qui EST la conclusion d'une vérification
ne peut pas être soumis à une vérification. Seul appelant de ce flag.

**Dédup sans `singletonKey`.** Plan 004 est TODO : les queues `standard` ignorent
`singletonKey`. La dédup est donc applicative et tenue par la DB — `unique(change_id)` sur
`signal_verifications` + `onConflictDoNothing().returning()`. Deux runs concurrents arrivent,
un seul insert survit, un seul fetch part. La double émission est bornée deux fois : ce
verrou, plus l'index unique préexistant `signals_change_id_uq`.

**La jointure fact block tient.** Vérifié puis testé : `buildSignalFacts` est ancré sur
`changes.detectedAt` (routes/signals.ts passe `row.changeDetectedAt`), pas sur
`signals.createdAt`. Une émission différée de 32 min est invisible à la fenêtre. Rien à
corriger — le test existe pour que ça reste vrai.

**Migration `0076`** : table `signal_verifications` (unique `change_id`, index
`(competitor_id, monitor_id, recorded_at)` et `(delta_fingerprint, recorded_at)`) + valeur
d'enum `page_variance` sur `source_type`. `emitted`/`signal_id` sont écrits par
generate-signal après l'insert : sans eux, « vérifié puis perdu dans un crash » et « vérifié
et livré » sont la même ligne, et la promesse de la phase devient inauditable.

**API** : `GET /signals/:id/detail` expose `verification` (outcome, les deux timestamps,
`gapMinutes`). Données seulement — le badge « ✓✓ 2 captures à N min d'écart » est P4.

**Tests** : `pnpm typecheck` ✓ (8/8) · shared 900 ✓ · scrapers 1145 ✓ · workers 418 ✓ ·
api 383 ✓ · web 214 ✓ · ai 214 ✓ · db 5 ✓ — 3279 au total, 0 fail. Périmètre du plan 028
(diff/scoring/significance) intouché, vérifiable au `git status`. Plan 004 lu, NON implémenté.

**Scénarios sur fixture, en dev** : `bun test test/verify-signal-delta.test.ts
test/ab-test-signal.test.ts` depuis `apps/workers` déroule les six chemins contre une page
stubée et une vraie Postgres in-process, en imprimant les lignes de log du worker
(quick → independent → confirmed · flip → not_reproduced · 403 → skipped + émis · 2 flips →
un `ab_test_suspected` · 3e flip sous cooldown → rien). Pas de script de démo séparé : il
serait du code mort à côté de tests qui montrent déjà exactement ça.

**Reste côté humain** :
- **Migration `0076` à appliquer** (une table neuve + une valeur d'enum) — staging d'abord,
  puis prod. Vérifier les migrations PENDING avant tout `db:migrate` sur un env partagé
  (`0075` de P1 est peut-être encore en attente).
- Déployer les workers (l'interception et le job sont worker-side ; le job tourne sur le
  worker `browser`). Rappel : `.env.worker` est lu au boot, il faut REDÉMARRER.
- Surveiller le premier `VERIFY_DELAY_MIN`. Deux nombres à regarder dans
  `signal_verifications` : la part de `skipped` (si elle est haute, la re-capture échoue et
  la vérification n'achète rien) et la part de `not_reproduced` (si elle est haute, soit les
  pages bougent vraiment beaucoup, soit 30 min est trop long). Le retune de `VERIFY_DELAY_MIN`
  vers 15 se décide sur ces données, pas avant.
- `SIGNAL_VERIFICATION_ENABLED=false` est le kill-switch : tout émet immédiatement,
  comportement pré-P2 exact.
- P3 à P5 (grounding réel, preuve visible, porte faithfulness) NON entamées.

## Véracité Intelligence v2, P3 : grounding réel, abstention, sorties contraintes (2026-08-05)

**Le fix n'est PAS de rallumer l'enveloppe de citations.** C'est la nuance de l'audit §3.1 :
le carve-out `grounding: false` sur les générations user-facing existe PARCE QUE l'enveloppe
casse les providers gratuits (un modèle de raisonnement malforme le JSON de citation, parse
miss, null, profil vide affiché comme « scan terminé »). P3 met à la place un contrôle
DÉTERMINISTE post-hoc : après le MÊME appel, on vérifie nous-mêmes que chaque chiffre et
chaque citation de la sortie existe dans la source montrée au modèle. Zéro token de sortie en
plus, zéro appel ajouté.

**Bilan net des appels IA : deux sites en moins, aucun en plus.** `insight.ts` régénérait une
fois quand un nombre n'était pas soutenu, `narrate-change.ts` re-rollait sur le même critère.
Les deux sont supprimés : redemander la même phrase sur la même source ne la rend pas plus
vraie, seulement plus assurée. `narrate_change` passe désormais par `groundedAiCall` mais
reste UN appel. Le null-rate d'`ai_runs` devrait baisser (deux tâches qui rendaient null
rendent maintenant un objet parsé), la volumétrie ne peut que descendre.

**`posthoc-grounding.ts` a MANGÉ `numeric-grounding.ts`, il ne le double pas.** L'ancien
module faisait déjà la moitié du travail, la règle de significativité : on ne vérifie pas le
« 2 » de « 2 plans », ni une année nue. Elle est reprise mot pour mot, plus la normalisation
des séparateurs de milliers et des espaces insécables, la lecture locale-consciente
(`1,299` = groupement en, `1.299` = groupement de/fr, `12,34` = décimale), une table explicite
k/M/bn, et les spans entre guillemets (substring exact après normalisation casse/espaces).
Chaque token porte le CHAMP d'où il vient, ce qui est ce qui rend l'abstention chirurgicale.
L'ancien fichier et son test sont supprimés, ses 11 cas repris dans les 19 du nouveau.

**Périmètre v1 assumé : chiffres et citations, pas les noms propres.** Un nom de produit ou de
personne est paraphrasé, décliné, possessivé : un test de présence littérale y étiquetterait
surtout des phrases vraies. Documenté dans l'en-tête du module comme une question V2.
L'appariement se fait sur la VALEUR, pas sur l'unité (« 32% » est soutenu par une source qui
imprime « 32 »). Volontairement lâche sur cet axe, le contrôle porte sur la fabrication.

**Abstention, jamais réécriture.** Un `unverified` sur `generate_signal` retire le CHAMP
fautif avant l'insert. `so_what` et `recommended_action` sont nullables, ils passent à null.
`insight` est NOT NULL : il est remplacé par une phrase déterministe construite sur le
human_change que le classifieur a extrait du diff (`Acme changed "$149/mo" to "$99/mo".`), et
aucun texte de modèle ne survit. Le signal SORT quand même, avec sa sévérité, sa catégorie,
son human_change et son fact block, qui n'ont jamais dépendu de la prose. Sur
`narrate_change`, la narration entière tombe (un paragraphe optionnel, rien à découper) et le
panneau rend le before/after déterministe qui est déjà sur la ligne.

**Ordre vérifié avec P2.** `interceptEmission` (P2) court AVANT l'appel insight et ne raisonne
que sur la sévérité, l'abstention court APRÈS et ne touche que la prose : les deux ne se
croisent jamais. L'abstention est en revanche placée AVANT la porte faithfulness, parce que la
porte doit juger ce qui sera publié et non une phrase déjà retirée (sinon elle bloque un
signal sur un texte que personne ne lira). La porte reste ÉTEINTE (plan 017 = P5).

**`narrate_change` a enfin un schéma**, défini depuis son usage réel en aval :
`signals.narrative` est UNE colonne texte nullable rendue en un paragraphe, donc
`{ narrative: string }` et rien de plus. Fini le parse de prose brute (audit §3.1,
`narrate-change.ts:63`) : un modèle qui préfaçait, écrivait du markdown ou répondait en deux
paragraphes mettait tout ça devant l'utilisateur.

**Sorties structurées natives, par capability.** `AI_PROVIDER_N_JSON_SCHEMA=true` déclare
qu'un provider honore `response_format: json_schema`. Le pool envoie alors le schéma zod durci
(`additionalProperties: false`, tout requis) sur `generate_signal` et `narrate_change`, et le
mode `json_object` partout ailleurs. Même appel, mêmes tokens, décodage contraint. DÉFAUT OFF
et il le reste : un provider qui annonce le champ mais refuse notre schéma répond 400, le seul
statut sur lequel le pool ne bascule volontairement PAS. À activer provider par provider après
vérification.

**Sémantique retry, auditée avant d'y toucher.** L'audit §3.2 décrit `classify-change.job.ts`
côté Trigger, or Trigger est retiré (#413/#415). Sous pg-boss le poison-pill est DÉJÀ corrigé :
`retriableClassifyError` (R2) lève une `Error` nue, `retryLimit: 2` par défaut, et
`deadLetter: outrival-dlq` est posé sur classify-change comme sur generate-signal. Ce qui
manquait, c'est la TRONCATURE : une réponse coupée à `max_tokens` se reproduit à l'identique
(même prompt, même budget), donc les trois tentatives achètent trois fois le même échec sur un
quota gratuit.

**Un troisième dénouement dans la queue : `DeadLetter`.** Il en manquait un. Un throw nu
dépense tout le budget de retry, `NonRetriable` complète en silence (c'est fait pour « le
monitor a été supprimé », pas pour « ce change n'est jamais devenu un signal »). `DeadLetter`
envoie le payload ORIGINAL sur la dead-letter avec une raison, puis complète le job. Le
payload part verbatim, accompagné d'une enveloppe `__dlq { queue, reason, jobId }` que le
dead-lettering natif de pg-boss n'emporte pas, ce qui est exactement comment 602 jobs se
retrouvent dans `outrival-dlq` sans qu'on puisse dire ce qu'ils étaient. Rejouer, c'est
renvoyer ce payload sur la queue qu'il nomme : rien n'a marqué le change comme traité, et
generate-signal est idempotent par `change_id`. Périmètre du plan 025 respecté (tuile et
paging NON implémentés), la capability atterrit proprement là où 025 ira compter.

**§3.2, les partiels persistés en valide.** `zipAssessments` : un tableau `assessments` de
longueur différente du nombre de changes est un PARSE FAIL, plus une queue de « minor »
fabriquée sous le nom du modèle et affichée dans « Why this insight? ». `isEmptyProfile` : une
extraction dont TOUS les champs sont vides n'est plus un succès, elle part sur le chemin
`parse_failed`. Le job n'atteint donc jamais son update, et un profil non-vide existant ne
peut pas être écrasé par un run qui n'a rien lu (au champ près, `refreshAuto` le tenait déjà).

**Migration `0077`** : `signals.grounding_status` (text) et `signals.grounding_unverified`
(jsonb), additive, deux colonnes nullables. `GET /signals/:id/detail` expose
`grounding { status, unverified }`. Données seulement : le badge « chiffres non vérifiés
omis » et le rendu des `validCitations` sont P4.

**Tests** : `pnpm typecheck` ✓ (8/8) · shared 900 ✓ · scrapers 1145 ✓ · workers 424 ✓ ·
api 383 ✓ · web 214 ✓ · ai 245 ✓ · db 5 ✓, soit 3316 au total, 0 fail (+37 vs P2). Les
nouveaux couvrent la normalisation (`1 299 €` = `$1,299` = `1299`, `32 %` = `32%`,
`10k` = `10 000`), les faux positifs (« 3 plans and 4 add-ons » n'est jamais lu comme 3004 et
n'est pas vérifié), la chaîne complète contrôle puis abstention (un `34%` inventé disparaît,
l'insight soutenu reste), `skipped` qui ne bloque jamais, la politique par tâche (battle_card
et digest hors P3), et la dead-letter (payload rejouable, raison distincte, jamais un
`NonRetriable`).

**Plans relus** : 025 TODO (alignement, rien de sa tuile implémenté) · 009 TODO (une erreur de
CONFIG n'est pas masquée, `isConfigError` continue de sortir en `misconfigured` et aucun retry
n'est ajouté dessus) · 006 TODO (logger inchangé) · 002 TODO, `packages/queue` n'a toujours
pas de runner de test, donc l'invariant dead-letter est testé depuis `apps/workers` qui
importe déjà `@outrival/queue` · 028 et le périmètre P1/P2 intouchés.

**Reste côté humain** :
- **Migration `0077` à appliquer** (deux colonnes additives), staging d'abord. Vérifier les
  PENDING avant tout `db:migrate` sur un env partagé (`0075` et `0076` de P1/P2 peuvent encore
  attendre).
- Déployer les workers (l'abstention et la sémantique dead-letter sont worker-side) puis
  l'API. `.env.worker` est lu au boot : REDÉMARRER.
- `AI_PROVIDER_N_JSON_SCHEMA` : laisser OFF au déploiement, puis tester provider par provider
  (Cerebras et Groq annoncent `json_schema` sur gpt-oss, et un 400 ne bascule pas).
- Regarder la répartition de `grounding_status` sur la première semaine. Une part
  d'`unverified` élevée veut dire une abstention trop agressive (donc des insights amputés),
  pas forcément un modèle menteur : c'est ce chiffre qui décidera d'un ajustement du seuil de
  significativité, pas une intuition. Un `skipped` élevé veut dire que les sources n'arrivent
  pas jusqu'au contrôle.
- P4 (preuve visible dans l'UI) et P5 (porte faithfulness, plan 017) NON entamées, la porte
  reste éteinte.
