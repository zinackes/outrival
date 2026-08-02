# Model routing — subagents Claude Code

## Routing par défaut

- Tâches simples / répétitives (lire un fichier, grep, recherche) → `haiku`
- Implémentation standard, refactoring, tests → `sonnet` (défaut)
- Décisions architecturales, revue de design, problèmes complexes → `opus`

Utiliser les alias (`haiku`/`sonnet`/`opus`), pas un id de modèle daté : un id
épinglé se périme et route vers un modèle retiré.

## Ne pas utiliser Opus pour

- Scaffolding de fichiers standard
- Écriture de tests unitaires simples
- Formatage et lint
- Migrations DB simples

## Compaction

- Utiliser /compact-smart (commande custom) plutôt que /compact seul
- Toujours préciser le focus : task_plan.md + findings.md + fichiers modifiés