#!/bin/bash
# PostToolUse hook — lance typecheck sur le package modifié après une édition

TOOL_NAME=$(echo "$1" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(echo "$1" | jq -r '.tool_input.path // empty' 2>/dev/null)

# S'activer uniquement sur les éditions de fichiers TypeScript
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "MultiEdit" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]]; then
  exit 0
fi

# Déterminer le package à partir du chemin
PACKAGE=""
if [[ "$FILE_PATH" == apps/web/* ]]; then PACKAGE="@outrival/web"
elif [[ "$FILE_PATH" == apps/api/* ]]; then PACKAGE="@outrival/api"
elif [[ "$FILE_PATH" == apps/workers/* ]]; then PACKAGE="@outrival/workers"
elif [[ "$FILE_PATH" == packages/db/* ]]; then PACKAGE="@outrival/db"
elif [[ "$FILE_PATH" == packages/ai/* ]]; then PACKAGE="@outrival/ai"
elif [[ "$FILE_PATH" == packages/scrapers/* ]]; then PACKAGE="@outrival/scrapers"
elif [[ "$FILE_PATH" == packages/shared/* ]]; then PACKAGE="@outrival/shared"
fi

if [[ -z "$PACKAGE" ]]; then
  exit 0
fi

# Lancer typecheck en background (ne bloque pas)
echo "[typecheck] Checking $PACKAGE..."
pnpm typecheck --filter "$PACKAGE" 2>&1 | tail -5
# Ne pas exit 1 même si erreur — juste loguer
exit 0