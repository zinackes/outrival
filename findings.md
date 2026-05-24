# Findings — Outrival

Découvertes techniques et décisions importantes accumulées au fil des sessions.

## Architecture

- PostgreSQL Railway = données relationnelles. ClickHouse = time-series uniquement.
- R2 = tout asset binaire (HTML snapshots, screenshots). Jamais en DB.
- Trigger.dev concurrencyKey = hostname du concurrent pour éviter les bans IP.
- Groq classification AVANT Claude Sonnet — ne jamais envoyer un change non-significatif à Claude.

## Patterns établis

(À compléter au fil des sessions)

## Erreurs connues et solutions

(À compléter au fil des sessions)

## Décisions de design

- Outrival = dark theme, amber (#F59E0B), Syne + Inter
- shadcn/ui new-york style, radius 6px, flat surfaces