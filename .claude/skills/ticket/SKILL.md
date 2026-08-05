---
description: Traite un ticket Linear de bout en bout
argument-hint: [OUT-XX]
disable-model-invocation: true
---

Traite l'issue Linear $ARGUMENTS via le MCP Linear.

## Étapes
1. Récupère titre, description, commentaires, labels, priorité de l'issue.
2. Explore le code concerné, puis propose-moi un plan en 3-5 points
   (fichiers touchés, approche, risques). ATTENDS ma validation avant
   de coder. Si le ticket est ambigu, pose tes questions d'abord.
3. Une fois validé : passe l'issue en "In Progress" et crée une branche
   avec le nom de branche fourni par Linear (gitBranchName).
4. Implémente, puis lance lint + tests.
5. Commits préfixés "$ARGUMENTS: ...". Ne push pas sans mon accord.
6. N'écris PAS de commentaire sur l'issue. Résume en 1-2 lignes max,
   et termine par le lien de la PR.
7. Passe l'issue en "In Review".

## Règles
- Reste dans le scope du ticket. Si tu découvres un autre bug,
  crée une nouvelle issue Linear au lieu de le corriger.
- Ne touche jamais aux secrets ni aux fichiers .env.
