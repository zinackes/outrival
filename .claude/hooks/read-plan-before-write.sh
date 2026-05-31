#!/bin/bash
# PreToolUse hook — relit task_plan.md avant chaque opération d'écriture
# Aide Claude Code à ne pas dériver de l'objectif de la session

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# S'activer uniquement sur les outils d'écriture
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" && \
      "$TOOL_NAME" != "MultiEdit" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Si task_plan.md n'existe pas, ne rien faire
if [[ ! -f "task_plan.md" ]]; then
  exit 0
fi

# Injecter le contenu dans le contexte (stdout est lu par Claude Code)
echo "=== PLAN ACTUEL (task_plan.md) ==="
cat task_plan.md
echo "=================================="

exit 0