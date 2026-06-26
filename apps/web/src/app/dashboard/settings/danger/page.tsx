import { DeleteWorkspaceCard } from "@/components/outrival/delete-workspace-card";
import { DeleteAccountCard } from "@/components/outrival/delete-account-card";

export default function DangerZonePage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight text-critical">
          Danger zone
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Irreversible actions on your workspace and account.
        </p>
      </header>

      <DeleteWorkspaceCard />
      <DeleteAccountCard />
    </section>
  );
}
