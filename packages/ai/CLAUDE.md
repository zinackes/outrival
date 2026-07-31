# @outrival/ai — Pipeline Claude + Groq

Stack : Anthropic SDK, Groq SDK

## Conventions
- Lire @.claude/skills/ai-pipeline/SKILL.md avant toute modification
- Groq d'abord (classification), Claude ensuite (insights) — règle absolue
- Prompts dans src/prompts/[name].prompt.ts — fonctions pures qui retournent des strings
- Parsing JSON : toujours try/catch, jamais de JSON.parse sans guard

## Modèles
- Pool (Cerebras p1 → Cloudflare p2 → Groq p3 → Mistral p4) : gpt-oss-120b (smart),
  gpt-oss-20b (fast, Groq + Cloudflare — Cerebras n'expose pas de petit modèle).
  Plus de plancher payant : Hyperbolic n'a jamais eu de clé et n'a jamais servi une
  seule requête (ai_runs, 05/06 au 31/07/2026), il est retiré. Les anciens
  llama-3.3-70b-versatile / llama-3.1-8b-instant sont arrêtés par Groq le 2026-08-16.
  ⚠️ `AI_CONFIG.model` est IGNORÉ sur le chemin pool : seul `tier` route le choix.
- Claude : claude-sonnet-4-6 (insights stratégiques, digests, battle cards)