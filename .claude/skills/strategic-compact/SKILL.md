---
name: strategic-compact
description: >
  Utiliser quand le contexte se remplit (>70%) ou avant une longue
  session de coding. Guide pour compacter intelligemment sans perdre
  le fil du projet.
allowed-tools: [Read, Write]
---

# Compact stratégique — Outrival

## Quand compacter

- Contexte > 70% utilisé
- Avant de commencer une nouvelle phase
- Après avoir terminé une étape complexe
- Quand les réponses commencent à ignorer des instructions antérieures

## Avant de compacter — checklist

1. Mettre à jour task_plan.md (statuts des étapes)
2. Mettre à jour findings.md (dernières découvertes)
3. Mettre à jour progress.md (dernières actions, fichiers modifiés)
4. S'assurer que pnpm typecheck passe

## La commande exacte
/compact focus on task_plan.md, findings.md, progress.md,
and the exact list of files modified in this session

## Après compaction — récupération

Claude Code re-lit automatiquement :
- CLAUDE.md racine
- task_plan.md (via hook read-plan-before-write)
- Les skills invoqués récemment

Pour aider la récupération, commencer la session suivante par :
"Lis task_plan.md et findings.md, puis résume où on en est."

## Ce qui sera perdu

- L'historique de conversation détaillé
- Les décisions prises verbalement (non écrites dans findings.md)
- Le contexte des erreurs résolues (écrire dans findings.md si important)