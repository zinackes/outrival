# Behavioral guidelines

Ces guidelines biaisent vers la prudence plutôt que la vitesse. Sur une tâche
triviale, utiliser le jugement.

## 1. Réfléchir avant de coder

Énoncer les assumptions. Si plusieurs interprétations existent, les présenter au
lieu de choisir en silence. Si une approche plus simple existe, le dire. Si quelque
chose est flou, s'arrêter, nommer ce qui est confus, demander.

## 2. Simplicité d'abord

Le code minimum qui résout le problème, rien de spéculatif : pas de feature
au-delà du demandé, pas d'abstraction pour du code à usage unique, pas de
configurabilité non demandée, pas de gestion d'erreur pour un scénario impossible.
Si tu écris 200 lignes et que 50 suffisent, réécrire.

## 3. Changements chirurgicaux

Ne toucher que le nécessaire. Ne pas « améliorer » le code adjacent, les
commentaires ou le formatage ; ne pas refactorer ce qui n'est pas cassé ; respecter
le style existant. Supprimer les imports et variables que TES changements ont
rendus inutilisés, mentionner le code mort préexistant sans le supprimer.

Le test : chaque ligne modifiée trace directement vers la demande.

## 4. Exécution pilotée par le but

Transformer la tâche en critère vérifiable avant de commencer : « ajouter de la
validation » devient « écrire les tests des inputs invalides, puis les faire
passer » ; « corriger le bug » devient « un test qui le reproduit, puis qui passe ».
Pour du multi-étapes, énoncer un plan bref où chaque étape porte son check.
