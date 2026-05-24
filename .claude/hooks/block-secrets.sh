#!/bin/bash
# PreToolUse hook — bloque les commits contenant des secrets

TOOL_NAME=$(echo "$1" | jq -r '.tool_name // empty' 2>/dev/null)
COMMAND=$(echo "$1" | jq -r '.tool_input.command // empty' 2>/dev/null)
CONTENT=$(echo "$1" | jq -r '.tool_input.content // empty' 2>/dev/null)

# Vérifier uniquement les git commits et les écritures de fichiers
if [[ "$TOOL_NAME" == "Bash" && "$COMMAND" == *"git commit"* ]]; then
  # Scanner les fichiers stagés pour des secrets
  STAGED=$(git diff --cached 2>/dev/null)
  PATTERNS=(
    "sk-[a-zA-Z0-9]{40}"
    "ANTHROPIC_API_KEY=[a-zA-Z0-9_-]+"
    "OPENAI_API_KEY=[a-zA-Z0-9_-]+"
    "GROQ_API_KEY=[a-zA-Z0-9_-]+"
    "STRIPE_SECRET_KEY=sk_"
    "password=[a-zA-Z0-9@$!%*#?&]{8,}"
  )

  for pattern in "${PATTERNS[@]}"; do
    if echo "$STAGED" | grep -qE "$pattern"; then
      echo "BLOCKED: Possible secret detected in staged files (pattern: $pattern)"
      echo "Remove the secret and use environment variables instead."
      exit 2
    fi
  done
fi

# Bloquer l'écriture de fichiers .env (sauf .env.example)
if [[ "$TOOL_NAME" == "Write" ]]; then
  FILE_PATH=$(echo "$1" | jq -r '.tool_input.path // empty' 2>/dev/null)
  if [[ "$FILE_PATH" == *".env"* && "$FILE_PATH" != *".env.example"* ]]; then
    echo "BLOCKED: Writing to .env files is not allowed. Use .env.local instead."
    exit 2
  fi
fi

exit 0