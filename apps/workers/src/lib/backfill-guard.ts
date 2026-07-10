import { checkAntiVoid } from "@outrival/scrapers/anti-void";

// ÉTAPE 3 (2026-07 audit) — anti-void parity for the archive backfill path.
//
// backfill-history already skips an archived DENY/challenge page (detectDenyPage +
// isCloudflareChallenge), but not an archive that came back near-empty for another
// reason (a Wayback redirect stub, a partial reconstruction). Seeded as a `success`
// archive snapshot it becomes a diff baseline of essentially "", so the archive→now
// diff fabricates a phantom "whole page added" change.
//
// The backfill path has no prior sizes (it's the first archive), so we use the fresh
// LIVE capture as the reference and reuse the tested absolute-emptiness fallback of
// checkAntiVoid: an absolutely-tiny archive against a substantive current page is a
// broken capture. A page that legitimately grew still carries real content (its
// extracted size clears the absolute ceiling), so genuine backfill value is kept.
export function isArchiveCaptureVoid(archiveSize: number, currentSize: number): boolean {
  return checkAntiVoid(archiveSize, [currentSize]).isVoid;
}
