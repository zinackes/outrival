#!/bin/bash
# PostToolUse hook — typecheck le package modifié après une édition TypeScript.
# Exit 2 sur échec : stderr remonte à Claude, qui corrige avant de continuer.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

case "$TOOL_NAME" in
Write | Edit | MultiEdit) ;;
*) exit 0 ;;
esac

case "$FILE_PATH" in
*.ts | *.tsx) ;;
*) exit 0 ;;
esac

# `file_path` arrive en ABSOLU. Le comparer à `apps/web/*` ne matche jamais —
# c'est ce qui rendait ce hook silencieusement inerte. Rendre relatif d'abord.
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE_PATH#"$ROOT"/}"

case "$REL" in
apps/web/*) PACKAGE="@outrival/web" ;;
apps/api/*) PACKAGE="@outrival/api" ;;
apps/workers/*) PACKAGE="@outrival/workers" ;;
packages/db/*) PACKAGE="@outrival/db" ;;
packages/ai/*) PACKAGE="@outrival/ai" ;;
packages/queue/*) PACKAGE="@outrival/queue" ;;
packages/scrapers/*) PACKAGE="@outrival/scrapers" ;;
packages/shared/*) PACKAGE="@outrival/shared" ;;
*) exit 0 ;;
esac

# Pas de pipe sur pnpm : `$?` serait celui de `tail`, jamais celui du typecheck.
OUTPUT=$(cd "$ROOT" && pnpm typecheck --filter "$PACKAGE" 2>&1)
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
	printf 'typecheck failed on %s — fix before continuing:\n%s\n' \
		"$PACKAGE" "$(printf '%s\n' "$OUTPUT" | tail -30)" >&2
	exit 2
fi

exit 0
