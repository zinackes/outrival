# Workflow Linear — cadrage d'une session

S'applique à toute session ouverte depuis un ticket Linear, quelle que soit la
convention du worktree : `.claude/worktrees/OUT-NN` (branche `worktree-OUT-NN`,
créé par `EnterWorktree`) ou `.t3/worktrees/outrival/t3code-<hash>` (branche
`zinacke/out-NN-<slug>`, créé par t3).

Objectif : donner le maximum de contexte utile à Claude Code, pour le minimum de
tokens facturés.

## Pourquoi ce fichier existe

Sur 49 sessions du 6 au 8 août, **46 % du coût** venait de tours au-dessus de
200k de contexte (facturés ~2x) et **17 %** de cache réécrit pour rien. Le
préambule complet (system prompt + schémas + CLAUDE.md + mémoire) ne pèse que
5 %. Autrement dit : ce n'est pas ce qu'on charge au démarrage qui coûte, c'est
la durée pendant laquelle on le traîne.

Deux règles en découlent :
1. Charger le contexte **tôt**, en une fois, pendant que le contexte est petit.
2. **Ne pas changer de mode** une fois le contexte gros. Une bascule
   `auto -> plan` à 160k réécrit tout le prompt système : ~360 000 unités sur
   trois tours, pour zéro travail produit.

## Décider du mode, en une question

> Est-ce que je sais déjà QUELS fichiers vont changer ?

- **Oui** → pas de plan mode. Attaquer directement.
- **Non** → plan mode, mais **dès le premier message**, jamais après.

Cette règle PRIME sur la préférence par défaut de Claude Code pour
`EnterPlanMode`. Si le tableau ci-dessous dit « direct », ne pas entrer en plan
mode, même si la tâche touche plusieurs fichiers, même si plusieurs approches
sont possibles.

Si le besoin de plan apparaît **en cours de session** :
1. NE PAS basculer en plan mode.
2. Écrire le plan dans le ticket Linear (`orca linear`), ou à défaut dans
   `docs/plans/OUT-NN.md`. Le plan transite par un fichier, pas par le contexte.
3. Le dire en une ligne et s'arrêter. `/clear`, puis session 2 exécute.

## Par type de ticket

| Type Linear | Mode | Contexte à charger d'entrée |
|---|---|---|
| **Bug** (repro connue) | direct | le stack trace + `codegraph_explore` sur le symbole fautif |
| **Bug** (cause inconnue) | **plan dès le 1er message** | la repro, puis exploration |
| **Feature** (spec claire) | direct | `codegraph_explore` sur la zone + le `CLAUDE.md` du package |
| **Feature** (spec floue) | **plan dès le 1er message** | le ticket entier + la zone de code |
| **Refonte UI** | direct | les composants nommés + `docs/` de la page |
| **Exploration / audit** | direct, **jamais plan** | rien au départ, laisser chercher |

### Signaux de sortie

Claude ne voit ni son nombre de tours ni la taille de son contexte : ces
signaux sont observables depuis la conversation, à annoncer sans les mesurer.

- **3e tour consécutif sans fichier modifié** → dire « on tourne en rond,
  `/clear` conseillé » et s'arrêter.
- **Besoin de lire un 3e package** → dire « ce ticket déborde, à découper » et
  s'arrêter.

Un ticket qui déclenche un de ces signaux est **découpé en deux tickets**, pas
poursuivi dans la même session.

## Le premier message d'une session

Un seul message, qui porte tout. Pas de dialogue d'échauffement.

```
OUT-NN — <titre>
Type: bug | feature | refonte-ui | exploration
Zone: <package(s) concerné(s)>

<le corps du ticket Linear, collé tel quel>

Critère de succès: <ce qui doit être vrai à la fin, vérifiable>
```

Le champ `Critère de succès` est le plus important : il permet de boucler sans
revenir demander « et maintenant ? ». Exemples corrects :
- « `pnpm typecheck` passe et le badge affiche la bonne couleur en dark mode »
- « un test reproduit le bug, puis passe »
- « la liste des fichiers à toucher, avec pour chacun ce qui change »

## Pendant la session

- **`/clear` entre deux tickets.** Réutiliser une session pour un autre ticket
  traîne 150k de contexte mort à chaque tour. Un `/clear` coûte un préambule
  (~94k, payé une fois) ; une session à 250k paie la surtaxe à chaque tour.
- **`codegraph_explore` avant tout `Read` d'exploration.** Un appel remplace une
  dizaine de grep/read et rend la source verbatim.
- **Ne pas désactiver autoCompact** dans un `settings.json` de worktree.

## Quand découper en deux sessions

Découper dès que l'une de ces conditions est vraie :
1. Le ticket touche plus de deux packages.
2. Il faut une décision produit à mi-parcours (le plan et l'exécution sont deux
   sessions distinctes).
3. Un signal de sortie ci-dessus est déclenché.

Le découpage type : session 1 = plan mode, produit un plan écrit dans le ticket
Linear ; session 2 = `/clear`, exécution directe à partir de ce plan. Le plan
transite par Linear, pas par le contexte.
