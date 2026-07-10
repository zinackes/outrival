-- Idempotent on purpose: this enum value was applied to a prod env ahead of this
-- PR's merge (out-of-order with #165's 0034), so a deploy that re-runs it is a
-- safe no-op instead of a "value already exists" failure.
ALTER TYPE "public"."source_type" ADD VALUE IF NOT EXISTS 'subdomains';