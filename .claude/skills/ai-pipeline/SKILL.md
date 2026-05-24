---
name: ai-pipeline
description: >
  Utiliser quand on implémente ou modifie la logique IA d'Outrival.
  Contient le pipeline Groq → Claude, les prompts types, et les règles
  de coût et de qualité.
allowed-tools: [Read, Write, Edit]
---

# Pipeline IA — Outrival

## Règle fondamentale : Groq d'abord, Claude ensuite
Groq llama-3.3-70b    → classification rapide et cheap (~$0.06/M tokens)
Claude Sonnet 4.6     → insights stratégiques premium (~$3/M tokens)

Ne jamais envoyer un Change à Claude Sonnet sans passer par Groq d'abord.
Si Groq dit is_significant = false → s'arrêter là.

## Client Groq

```typescript
// packages/ai/src/clients/groq.ts
import Groq from "groq-sdk";
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function classifyChange(diffText: string): Promise<Classification> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{
      role: "user",
      content: `Classify this competitor change. Respond ONLY with valid JSON.
      
<change>${diffText}</change>

Respond with:
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one sentence"
}`
    }],
    response_format: { type: "json_object" },
  });
  return JSON.parse(response.choices[0].message.content!);
}
```

## Client Claude

```typescript
// packages/ai/src/clients/claude.ts
import Anthropic from "@anthropic-ai/sdk";
export const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSignalInsight(
  change: Change,
  competitor: Competitor,
  classification: Classification
): Promise<SignalInsight> {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `<context>
Concurrent : ${competitor.name} (${competitor.url})
Catégorie produit : ${competitor.category}
Changement détecté : ${classification.category} / sévérité ${classification.severity}
</context>

<change>
${change.diffText}
</change>

<task>
Génère un insight stratégique pour ce changement concurrent.
Réponds UNIQUEMENT en JSON valide.
</task>

Réponds avec :
{
  "insight": "Ce qui s'est passé en 1-2 phrases factuelles",
  "so_what": "Implication stratégique pour l'utilisateur en 1-2 phrases",
  "recommended_action": "Action concrète optionnelle ou null"
}`
    }],
  });
  
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return JSON.parse(text);
}
```

## Prompts — règles d'écriture

- Toujours utiliser des XML tags pour structurer : <context>, <change>, <task>
- Toujours demander un JSON strict quand une structure est attendue
- Toujours préciser "Réponds UNIQUEMENT en JSON valide" pour éviter le markdown
- Garder les prompts courts — Claude Sonnet n'a pas besoin de beaucoup de contexte pour les insights
- Les prompts vivent dans packages/ai/src/prompts/[name].prompt.ts

## Génération du digest hebdomadaire

Le digest est le seul endroit où on peut envoyer beaucoup de tokens à Claude.
Format : agréger les signals de la semaine en JSON → un seul appel Claude Sonnet.
Jamais faire N appels Claude pour N signaux — toujours batch.