# Règles jobs Trigger.dev v3

S'applique aux fichiers **/*.job.ts

## Structure obligatoire

- Chaque job dans apps/workers/src/jobs/[name].job.ts
- Export nommé : export const [nomCamelCase]Job = task({ id: "kebab-case-id", ... })
- id du job : kebab-case descriptif (ex: scrape-pricing-page, generate-weekly-digest)

## Idempotence

- TOUJOURS concevoir les jobs pour être idempotents (relancé = pas de doublon)
- Utiliser content_hash pour détecter si un snapshot est déjà identique
- Vérifier en DB si le job a déjà été exécuté avec les mêmes params avant de traiter

## Logging

- TOUJOURS context.log() au début : context.log("Starting [job-name]", { params })
- TOUJOURS context.log() à la fin : context.log("Completed [job-name]", { result })
- Logger les étapes intermédiaires importantes

## Config

- maxAttempts: 3 par défaut sur tous les jobs
- Utiliser triggerAndWait() pour les sous-tâches dépendantes
- Concurrency : max 1 job de scraping par domaine simultanément (utiliser concurrencyKey)

## Erreurs

- Ne jamais catch et ignorer les erreurs — laisser Trigger.dev gérer les retries
- En cas d'erreur métier (non-retriable) : throw new AbortTaskRunError("raison")