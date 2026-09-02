// The throwing variant lives in @outrival/shared alongside the best-effort one, so
// both go through the same SSRF/redirect guard (code:SEC-04). Kept as a re-export
// rather than a second implementation — the local copy diverging from its
// package-mate is exactly what left this path unguarded.
export { sendSlackMessageOrThrow as sendSlackMessage } from "@outrival/shared";
