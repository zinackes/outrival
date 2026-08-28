# Git

- Commiter à chaque unité de travail terminée (une feature, un fix, un refactor qui
  typecheck), sans attendre qu'on le redemande. Pas de gros commit fourre-tout en
  fin de session.
- Toujours `git add -A`. Jamais de cherry-pick manuel de fichiers : des fichiers non
  liés qui traînent sont le signe qu'il fallait commiter plus tôt, on committe quand
  même tout et on repart propre.
- Conventional Commits stricts (`feat|fix|refactor|docs|test|chore`), sujet à
  l'impératif de 50 caractères max, description qui dit le *pourquoi*.
