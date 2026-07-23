// Moved to @outrival/shared so the API can reuse the shell for on-demand digest
// sends. Re-exported here to keep existing worker imports (`../lib/email-shell`)
// stable. `e` emits the class + light inline style pair every themed element needs.
export { emailShell, e } from "@outrival/shared";
