#!/bin/bash
# DÉSENREGISTRÉ le 2026-08-07 — ce script n'est plus câblé dans settings.json.
# Il reste sur disque pour pouvoir être remis si `task_plan.md` redevient un plan
# vivant. En l'état il ne l'est plus : les 26 étapes `- [ ]` qu'il remontait sont
# des reliquats de patch-13/17/22 livrés depuis des mois, donc il injectait
# ~700 tokens de bruit par session pour zéro signal. Le remettre suppose d'abord
# de purger l'historique de task_plan.md (1924 lignes).
#
# PreToolUse hook — rappelle le plan courant avant une écriture, pour ne pas
# dériver de l'objectif de session.
#
# Ce hook faisait `cat task_plan.md` en entier. Le fichier fait 1900+ lignes dont
# ~1880 d'historique de patches déjà livrés, réinjectées à CHAQUE édition. On ne
# remonte plus que l'en-tête (phases / phase en cours / patches) et les étapes
# encore ouvertes ; l'historique se lit à la demande.
#
# Même réduit à ~70 lignes il restait cher, et pour une raison qui ne saute pas
# aux yeux : un contexte injecté n'est PAS un coût ponctuel. Il entre dans la
# conversation et repart avec chaque appel d'outil suivant jusqu'à la fin de la
# session. Une session à 24 éditions payait donc ~900 tokens × 24 en injection,
# puis les retransmettait à chaque tour. Or le rappel n'a de valeur qu'avant la
# PREMIÈRE écriture : au vingtième edit du même fichier, il ne dit plus rien.
# Il ne sort donc qu'une fois par session, gardé par un fichier témoin.

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

# Une fois par session. `session_id` vient du payload du hook ; sans lui on
# retombe sur le PPID, stable pour la durée du process Claude. Le témoin vit dans
# le tmp de la machine, donc il disparaît au reboot et jamais dans le repo.
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
MARKER="${TMPDIR:-/tmp}/claude-plan-reminder-${SESSION:-$PPID}"
[ -e "$MARKER" ] && exit 0
: >"$MARKER"

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
