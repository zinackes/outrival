// Outbound webhook push (Phase C). Single-sourced in @outrival/shared —
// apps/workers can't import @outrival/api, so the signer + sender live there
// so both apps share one copy. See docs/distribution-team.md.

export { signBody, sendWebhook as pushWebhook } from "@outrival/shared";
