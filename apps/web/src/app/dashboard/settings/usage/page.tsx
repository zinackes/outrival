import { UsageDashboard } from "@/components/outrival/usage-dashboard";

export default function UsagePage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="font-semibold text-base tracking-tight">Usage</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Where you stand against your plan limits.
        </p>
      </header>
      <UsageDashboard />
    </section>
  );
}
