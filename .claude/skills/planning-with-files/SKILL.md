---
name: planning-with-files
description: >
  Utiliser quand on commence une nouvelle tâche complexe, une nouvelle phase,
  ou quand le contexte risque de se remplir sur une longue session.
  Active la planification persistante Manus-style avec 3 fichiers markdown.
  Invoquer avec /plan ou automatiquement sur les tâches multi-étapes.
allowed-tools: [Read, Write, Edit]
---

# Planning with Files — Manus Style

## Principe fondamental

Context Window = RAM (volatile, limitée)
Filesystem = Disque (persistant, illimité)
→ Tout ce qui est important va sur disque.

## Les 3 fichiers

### task_plan.md — Le roadmap
Créer ou mettre à jour avant de commencer. Contient :
- L'objectif de la session / phase
- Les étapes avec statuts (pending / in_progress / complete / blocked)
- Les décisions architecturales prises
- Les blockers identifiés

Format :
Objectif
[Ce qu'on veut accomplir]
Étapes

 Étape 1 — pending
 Étape 2 — complete
[-] Étape 3 — in_progress

Décisions

[Décision prise et pourquoi]

Blockers

[Blockers identifiés]


### findings.md — Les recherches
Mettre à jour toutes les 2 opérations de lecture/exploration. Contient :
- Découvertes techniques importantes
- Comportements inattendus du code
- Choix techniques et leur justification
- Ce qu'il NE FAUT PAS faire et pourquoi

### progress.md — Le log de session
Mettre à jour après chaque étape complétée. Contient :
- Ce qui a été fait (avec timestamps)
- Résultats des tests
- Fichiers modifiés
- Prochaine étape prévue

## Règles d'utilisation

1. TOUJOURS créer task_plan.md avant de commencer une phase
2. Relire task_plan.md avant chaque décision majeure
3. La règle des 2 actions : après 2 lectures/recherches → update findings.md
4. Quand une étape est terminée → update task_plan.md + progress.md
5. Avant /compact → s'assurer que tout est à jour dans les 3 fichiers

## Sur /compact

Utiliser : /compact focus on task_plan.md, findings.md, and the list of modified files

## Récupération de session

En début de nouvelle session :
1. Lire task_plan.md → reprendre où on s'est arrêté
2. Lire findings.md → récupérer le contexte technique
3. Lire progress.md → voir les dernières actions