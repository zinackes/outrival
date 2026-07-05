// Moved to @outrival/shared so the API can reuse the shell for on-demand digest
// sends. Re-exported here to keep existing worker imports (`../lib/email-shell`) stable.
export { darkEmailShell } from "@outrival/shared";
