# @outrival/ai — Pipeline Claude + Groq

Stack : Anthropic SDK, Groq SDK

## Conventions
- Lire @.claude/skills/ai-pipeline/SKILL.md avant toute modification
- Groq d'abord (classification), Claude ensuite (insights) — règle absolue
- Prompts dans src/prompts/[name].prompt.ts — fonctions pures qui retournent des strings
- Parsing JSON : toujours try/catch, jamais de JSON.parse sans guard

## Modèles
- Pool (Cerebras p1 → Groq p2 → Hyperbolic p3) : gpt-oss-120b (smart), gpt-oss-20b
  (fast, Groq seulement — Cerebras n'expose pas de petit modèle). Les anciens
  llama-3.3-70b-versatile / llama-3.1-8b-instant sont arrêtés par Groq le 2026-08-16.
  ⚠️ `AI_CONFIG.model` est IGNORÉ sur le chemin pool : seul `tier` route le choix.
- Claude : claude-sonnet-4-6 (insights stratégiques, digests, battle cards)