import { resolveMx, resolve } from "node:dns/promises";
import { getRedis } from "@outrival/shared";

/**
 * Signup abuse defenses layered on top of the disposable-domain block and the
 * per-email/IP OTP rate limit. All fail OPEN — a missing Redis or a flaky DNS
 * resolver must never turn away a legitimate user; these only tighten the net
 * when they can act with confidence.
 */

const DAY_SECONDS = 86_400;
const MX_CACHE_SECONDS = 7 * DAY_SECONDS;

// Max DISTINCT new mailboxes one IP may register per 24h. <=0 disables the cap.
const SIGNUP_IP_DAILY_CAP = Number(process.env.SIGNUP_IP_DAILY_CAP ?? 5);
const MX_CHECK_ENABLED = process.env.SIGNUP_MX_CHECK_ENABLED !== "false";

/**
 * True once an IP has registered SIGNUP_IP_DAILY_CAP distinct new mailboxes in the
 * last 24h. Counts DISTINCT canonical mailboxes via an NX guard, so a legit new
 * user re-requesting a code for the same address doesn't burn quota, and Gmail
 * +tag/dot variants (same canonical) count once. Call ONLY for would-be sign-ups
 * (unknown email) so real logins from a shared NAT IP are never throttled.
 *
 * Fail-open: no Redis, disabled cap, or no reliable client IP → false.
 */
export async function overSignupIpCap(
  ip: string | null,
  canonicalEmail: string,
): Promise<boolean> {
  if (SIGNUP_IP_DAILY_CAP <= 0) return false;
  if (!ip) return false;
  const redis = getRedis();
  if (!redis) return false;

  const countKey = `signup:ip:${ip}`;
  const seenKey = `signup:ip:${ip}:seen:${canonicalEmail}`;

  // NX: only the FIRST time this IP sees this mailbox does it count toward the cap.
  const firstTime = await redis.set(seenKey, "1", { ex: DAY_SECONDS, nx: true });
  if (firstTime === null) {
    // Already counted this mailbox for this IP — re-check the standing count only.
    const current = Number((await redis.get<string>(countKey)) ?? 0);
    return current > SIGNUP_IP_DAILY_CAP;
  }

  const count = await redis.incr(countKey);
  if (count === 1) await redis.expire(countKey, DAY_SECONDS);
  return count > SIGNUP_IP_DAILY_CAP;
}

/**
 * True if the domain can plausibly receive mail: an MX record, or (RFC 5321 §5.1
 * implicit MX) an A/AAAA record. Only a domain that resolves to NEITHER is treated
 * as undeliverable — that catches typo'd and throwaway domains the static blocklist
 * misses, without punishing the rare A-only mail domain. Cached 7d.
 *
 * Fail-open: any unexpected resolver failure → true. Kill-switch: SIGNUP_MX_CHECK_ENABLED=false.
 */
export async function domainCanReceiveMail(domain: string): Promise<boolean> {
  if (!MX_CHECK_ENABLED) return true;
  const redis = getRedis();
  const cacheKey = `mx:${domain}`;
  if (redis) {
    const cached = await redis.get<string>(cacheKey);
    if (cached === "1") return true;
    if (cached === "0") return false;
  }

  let ok = true;
  try {
    const mx = await resolveMx(domain).catch(() => [] as { exchange: string }[]);
    if (mx.length > 0) {
      ok = true;
    } else {
      const a = await resolve(domain).catch(() => [] as string[]);
      ok = a.length > 0;
    }
  } catch {
    ok = true; // fail-open on anything unexpected
  }

  if (redis) await redis.set(cacheKey, ok ? "1" : "0", { ex: MX_CACHE_SECONDS });
  return ok;
}

/**
 * Cheap heuristic flag for a random-looking local part (bot pattern: `x7k2p9qab@`).
 * NON-blocking by design — it feeds a PostHog signal so we can measure prevalence
 * and later decide whether to act; blocking on it would false-positive on plenty of
 * legitimate machine/role addresses. Ignores the +tag.
 */
export function localPartLooksRandom(localPart: string): boolean {
  const s = (localPart.split("+")[0] ?? localPart).toLowerCase();
  if (s.length < 10) return false;
  const digits = (s.match(/\d/g) ?? []).length;
  const letters = (s.match(/[a-z]/g) ?? []).length;
  const vowels = (s.match(/[aeiou]/g) ?? []).length;
  const digitRatio = digits / s.length;
  const vowelRatio = letters > 0 ? vowels / letters : 0;
  // Digit-heavy, or a long token almost devoid of vowels — both read as generated.
  return digitRatio > 0.4 || (letters >= 8 && vowelRatio < 0.15);
}
