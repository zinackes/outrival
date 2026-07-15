// Request headers + User-Agent shared by every scrape level (L0 fetch, L1/L2
// browser render). The collection doctrine renders in the open: a single,
// identifiable User-Agent that names us and links to /bot (how to block us). No
// rotation, no browser impersonation — usurping a real browser's identity is
// exactly the behaviour we abandoned. realisticHeaders() stays: Accept /
// Accept-Language are ordinary request headers, not an impersonation.

export const OUTRIVAL_UA =
  "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.app/bot)";

export function realisticHeaders(): Record<string, string> {
  return {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
}
