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

# Seuls les packages FEUILLES sont typecheckés à l'édition. Mesuré sur cache
# froid (2026-08-07) : shared 2,7s · queue 5,1s · ai 6,3s · scrapers 6,8s ·
# db 7,2s, contre api 12,3s · workers 23,9s · web 24,1s.
#
# L'écart n'est pas une question de taille de package : `--filter` sur une app
# fait retypechecker toute sa chaîne de deps par turbo. Éditer un fichier de
# `apps/web` payait donc 24s À CHAQUE ÉDIT, soit ~8 min sur une session de 20
# éditions, pour ce que `pnpm typecheck` (gate 1 de CLAUDE.md) fait en une passe
# avant commit. Les apps sortent du hook ; le filet reste là où il est gratuit.
case "$REL" in
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

[ "$STATUS" -eq 0 ] && exit 0

# Ne remonter que les diagnostics. `tail -30` renvoyait le log turbo complet —
# cache hits, chemins de packages, ELIFECYCLE, tableau récapitulatif — soit ~500
# tokens dont 3 lignes utiles, et ce bruit reste dans la conversation jusqu'à la
# fin de la session. On filtre sur les lignes `error TSxxxx`, seul contenu
# actionnable, en retirant le préfixe `@outrival/x:typecheck:` que turbo colle
# devant chacune.
ERRORS=$(printf '%s\n' "$OUTPUT" |
	grep -E 'error TS[0-9]+' |
	sed -E 's/^[^ ]*:typecheck: //' |
	head -15)

# Un échec sans une seule ligne `error TS` n'est pas une erreur de type : c'est
# l'outillage qui a cassé (turbo absent, node_modules manquants dans un worktree
# neuf, OOM). Le diagnostic est alors dans les dernières lignes, pas dans un
# filtre qui ne matcherait rien — et le silence enverrait chercher un bug de
# type inexistant.
if [ -z "$ERRORS" ]; then
	printf 'typecheck could not run on %s (toolchain error, not a type error):\n%s\n' \
		"$PACKAGE" "$(printf '%s\n' "$OUTPUT" | tail -8)" >&2
	exit 2
fi

printf 'typecheck failed on %s — fix before continuing:\n%s\n' "$PACKAGE" "$ERRORS" >&2
exit 2
