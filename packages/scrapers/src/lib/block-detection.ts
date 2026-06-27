// Pure HTML heuristics for recognising an anti-bot interstitial — the page a bot
// is served INSTEAD of the real content (Cloudflare challenge, "verify you are
// human", JS/cookie wall). Kept browser-free (no Patchright import) so both the
// cascade (scrape-direct L0, scrape-patchright L1-L4) and downstream consumers
// (the summary jobs, as a defence-in-depth guard against summarising a captured
// challenge page) can import it cheaply.

// Lowercased substrings. The legacy "Just a moment" IUAM page set its <title> to
// something Cloudflare-flavoured, but the modern managed-challenge / Turnstile
// interstitial uses the bare domain as the title and a body that reads "Verifying
// you are human" / "Checking the site connection security" — which the old title
// check missed entirely, so the challenge shell was stored as real content. The
// `cdn-cgi/challenge-platform` orchestration script is the most reliable tell and
// is injected only by a Cloudflare challenge response (NOT by a standalone
// Turnstile widget, which loads from challenges.cloudflare.com — left unmatched so
// a legit form embedding Turnstile is never mistaken for a block).
const CHALLENGE_MARKERS = [
  "cf-challenge-running",
  "cf-browser-verification",
  "cdn-cgi/challenge-platform",
  "just a moment...",
  "verifying you are human",
  "verify you are human",
  "checking the site connection security",
  "enable javascript and cookies to continue",
  "needs to review the security of your connection",
  "checking your browser before accessing",
];

export function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    CHALLENGE_MARKERS.some((marker) => lower.includes(marker)) ||
    /<title>[^<]*cloudflare/i.test(html)
  );
}
