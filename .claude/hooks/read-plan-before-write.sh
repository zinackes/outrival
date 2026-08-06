#!/bin/bash
# PreToolUse hook — rappelle le plan courant avant une écriture, pour ne pas
# dériver de l'objectif de session.
#
# Ce hook faisait `cat task_plan.md` en entier. Le fichier fait 1900+ lignes dont
# ~1880 d'historique de patches déjà livrés, réinjectées à CHAQUE édition. On ne
# remonte plus que l'en-tête (phases / phase en cours / patches) et les étapes
# encore ouvertes ; l'historique se lit à la demande.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL_NAME" in
Write | Edit | MultiEdit) ;;
*) exit 0 ;;
esac

# Chemin ancré : en relatif le hook était muet dès que le cwd n'était pas la racine.
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLAN="$ROOT/task_plan.md"
[ -f "$PLAN" ] || exit 0

HEAD_LINES=$(sed -n '1,40p' "$PLAN")
OPEN_STEPS=$(grep -n '^\s*- \[ \]' "$PLAN" | head -20)

CONTEXT="=== task_plan.md — en-tête ===
$HEAD_LINES

=== Étapes encore ouvertes ===
${OPEN_STEPS:-(aucune)}

L'historique complet des patches livrés est dans $PLAN — le lire à la demande,
il n'est pas réinjecté ici."

jq -n --arg ctx "$CONTEXT" \
	'{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'

exit 0
