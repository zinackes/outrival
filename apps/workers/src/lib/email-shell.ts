// Moved to @outrival/shared so the API can reuse the shell for on-demand digest
// sends. Re-exported here to keep existing worker imports (`../lib/email-shell`)
// stable. `e` emits the class + light inline style pair every themed element needs;
// `t` is the type-scale role that goes with it (colour from `e`, size/weight from `t`),
// so a worker template never hand-picks a pixel size again.
export {
  emailShell,
  emailSectionHead,
  severityDot,
  type EmailSeverity,
  e,
  t,
} from "@outrival/shared";
