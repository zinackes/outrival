# Règles Git — commits

S'applique à tout le repo.

## Commiter à chaque unité de travail

- TOUJOURS commiter après chaque feature, modif ou fix terminé — pas de gros
  commit fourre-tout en fin de session.
- Un commit = un changement cohérent et complet (qui typecheck / build).
- Ne pas attendre que l'utilisateur le redemande à chaque fois : dès qu'une
  unité de travail est finie, commiter.

## Stager tout, ne pas cherry-pick

- TOUJOURS `git add -A` (ou `git add .`) — stager TOUS les changements.
- JAMAIS sélectionner manuellement un sous-ensemble de fichiers à committer.
- Si des fichiers non liés traînent, c'est un signal qu'il fallait commiter
  plus tôt — committer quand même tout, puis repartir propre.

## Format

- Conventional Commits stricts : feat / fix / refactor / docs / test / chore.
- Subject ≤ 50 chars, à l'impératif.
- La description explique le « pourquoi », pas le « quoi ».
