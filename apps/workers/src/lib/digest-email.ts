// The digest email renderer moved to @outrival/shared so both the weekly job and
// the API's on-demand send/resend endpoint render an identical email. The AI
// `Digest` passed by the weekly job is structurally compatible with DigestEmailData.
export { renderDigestEmail, type DigestEmailData } from "@outrival/shared";
