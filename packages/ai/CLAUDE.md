# @outrival/ai

## Pureté

Les tâches de `src/tasks/*` sont **pures** : elles prennent des données, appellent le
pool, retournent du parsé. Elles ne loguent pas et n'écrivent pas en DB. Le logging
`ai_runs` est fait par l'appelant, via `loggedAi()` (`apps/workers/src/lib/analytics.ts`).

## Routing du pool

`src/provider.ts` cascade Cloudflare Workers AI p2, Groq p3, Mistral p4. Cerebras
(anciennement p1) a été retiré le 2026-09-04 : plus de crédit depuis le 2026-08-17.
Le slot `AI_PROVIDER_1_*` est libre, un trou ne désactive que son slot.

⚠️ **`AI_CONFIG.model` est IGNORÉ sur le chemin pool.** Seul `tier` route le choix :
`"smart"` donne `gpt-oss-120b`, `"fast"` donne `gpt-oss-20b`. Poser un `model` en
pensant changer de modèle ne fait rien, et l'échec est silencieux.

La liste des modèles vit dans `docs/architecture.md`. Ne pas la dupliquer ici, elle
bouge au rythme des arrêts côté fournisseur.

## Prompts

- Un prompt = une fonction pure qui retourne une string, dans le fichier de sa tâche.
- Écrits en anglais **et** instruisant explicitement le modèle de répondre en anglais
  (`.claude/rules/language.md`) : un prompt français produit une sortie française qui
  atterrit telle quelle dans l'UI.
- Parsing de la sortie : toujours gardé (try/catch), jamais un `JSON.parse` nu.

## Grounding

`src/grounding/` impose de citer sa source et **d'abstenir plutôt que d'inventer un
chiffre**. Une tâche absente de `GROUNDING_POLICY` (`grounding/grounded-call.ts`)
hérite du défaut `{ grounding: true, confidence: true }` : si son prompt ne produit
pas cette enveloppe, elle échoue en `parse_failed` sans dire pourquoi. Ajouter une
tâche factuelle veut dire ajouter son entrée.

## Tests

Tests **colocalisés** (`src/**/*.test.ts`, exclus du tsconfig) :
`pnpm test:local --filter @outrival/ai`. Les scripts `eval:*` tapent de vrais
providers et ne font pas partie de la suite.
