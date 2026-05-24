# Model routing — subagents Claude Code

## Routing par défaut

- Tâches simples / répétitives (lire un fichier, grep, recherche) → claude-haiku-4-5
- Implémentation standard, refactoring, tests → claude-sonnet-4-6 (défaut)
- Décisions architecturales, revue de design, problèmes complexes → claude-opus-4-7

## Ne pas utiliser Opus pour

- Scaffolding de fichiers standard
- Écriture de tests unitaires simples
- Formatage et lint
- Migrations DB simples

## Compaction

- Utiliser /compact-smart (commande custom) plutôt que /compact seul
- Toujours préciser le focus : task_plan.md + findings.md + fichiers modifiés