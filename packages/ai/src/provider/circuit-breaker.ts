import { redis, sendSlackMessage } from "@outrival/shared";

/**
 * Global circuit breaker (patch-22). Per-provider breakers (provider-pool.ts) skip
 * one bad provider; this global breaker trips when AI calls keep failing across ALL
 * providers, so the whole pipeline fails fast and the UI degrades gracefully instead
 * of hammering dead providers. State lives in Redis (shared across isolated
 * Trigger.dev run machines); without Upstash the facade no-ops → breaker never trips.
 */
const BREAKER_KEY = "ai:global_breaker";
const FAILURE_KEY = "ai:failures:global";
const FAILURE_WINDOW_SEC = 600; // 10-min rolling window for the consecutive-failure count

export class AIUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AIUnavailableError";
  }
}

export interface BreakerState {
  open: boolean;
  reason?: string;
  resetInSec?: number;
}

export async function checkGlobalBreaker(): Promise<BreakerState> {
  const reason = await redis.get(BREAKER_KEY);
  if (!reason) return { open: false };
  const ttl = await redis.ttl(BREAKER_KEY);
  return { open: true, reason: String(reason), resetInSec: ttl > 0 ? ttl : undefined };
}

export async function tripGlobalBreaker(reason: string): Promise<void> {
  const resetMin = Number(process.env.AI_CIRCUIT_BREAKER_RESET_MIN ?? 10);
  await redis.set(BREAKER_KEY, reason, { ex: resetMin * 60 });
  // The streak has spent itself on this trip, so it must not outlive the park it
  // bought. It otherwise does, by construction: the count sits on a 10-minute window
  // while the park runs AI_CIRCUIT_BREAKER_RESET_MIN (2 minutes on prod), so the
  // breaker reopens with the count still above the threshold and the very next
  // failure re-trips it on a count of one. Measured on prod 2026-09-04: the park
  // expired with ai:failures:global at 26 against a threshold of 20, and AI stayed
  // dark in a loop no single failure justified.
  await redis.del(FAILURE_KEY);
  // Best-effort ops ping; sendSlackMessage is silent when the webhook is unset/down.
  await sendSlackMessage(
    process.env.OPS_SLACK_WEBHOOK_URL ?? "",
    `🔴 Outrival: AI providers circuit breaker tripped (${reason}). AI generation paused for ~${resetMin}min.`,
  );
}

/** Count a failed AI call; trip the global breaker once they pile up in the window. */
export async function recordFailure(providerId?: string): Promise<void> {
  const threshold = Number(process.env.AI_CIRCUIT_BREAKER_THRESHOLD ?? 5);
  const count = await redis.incr(FAILURE_KEY);
  await redis.expire(FAILURE_KEY, FAILURE_WINDOW_SEC);
  if (count >= threshold) {
    await tripGlobalBreaker(providerId ? `too_many_failures:${providerId}` : "too_many_failures");
  }
}

/** A success clears the consecutive-failure streak. */
export async function recordSuccess(): Promise<void> {
  await redis.del(FAILURE_KEY);
}
