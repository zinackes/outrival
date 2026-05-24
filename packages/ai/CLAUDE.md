# @outrival/ai — Pipeline Claude + Groq

Stack : Anthropic SDK, Groq SDK

## Conventions
- Lire @.claude/skills/ai-pipeline/SKILL.md avant toute modification
- Groq d'abord (classification), Claude ensuite (insights) — règle absolue
- Prompts dans src/prompts/[name].prompt.ts — fonctions pures qui retournent des strings
- Parsing JSON : toujours try/catch, jamais de JSON.parse sans guard

## Modèles
- Groq : llama-3.3-70b-versatile (classification, résumés bulk)
- Claude : claude-sonnet-4-6 (insights stratégiques, digests, battle cards)