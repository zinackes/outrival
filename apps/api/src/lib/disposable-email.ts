import { isDisposableEmail as isDisposableUpstream } from "disposable-email-domains-js";

/**
 * Authoritative disposable / temporary-email check, server-side only. Backed by
 * the community-maintained `disposable-email-domains` blocklist (thousands of
 * domains, auto-published) — far broader than the tiny curated list baked into
 * `@outrival/shared`'s `emailSchema`, which stays for instant client-side
 * feedback on the obvious cases.
 *
 * The big list is deliberately NOT in `@outrival/shared`: that package is bundled
 * into the web client, and shipping thousands of domains to the browser would
 * bloat the auth page for no gain (the block must be enforced server-side anyway,
 * since a client check is trivially bypassed).
 *
 * Wired into every account-creation choke point (see routes/auth.ts and
 * lib/auth.ts) so a throwaway inbox can never spin up free accounts at our cost.
 */
export function isDisposableEmail(email: string): boolean {
  return isDisposableUpstream(email.trim().toLowerCase());
}
