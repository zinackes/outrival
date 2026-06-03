import { notFound } from "next/navigation";
import { FEATURE_FLAGS } from "@outrival/shared";

// patch-29 — the Members section is structurally in place but hidden until
// multi-user (invitations/RBAC, roadmap Phase 10) ships. In single-user mode the
// route 404s and never appears in the settings sub-sidebar. When the flag flips on,
// this renders the member list + invitations.
export default function MembersSettingsPage() {
  if (!FEATURE_FLAGS.multiUser) notFound();

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Members</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Invite teammates and manage their roles.
        </p>
      </header>
    </section>
  );
}
