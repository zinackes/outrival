import { Suspense } from "react";
import { BillingDashboard } from "@/components/outrival/billing-dashboard";
import { BillingDashboardSkeleton } from "./billing-skeleton";
import { getBillingData } from "@/lib/api-server";

export default async function BillingPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside the
  // dashboard.
  const initialBilling = await getBillingData();
  return (
    <section className="flex flex-col gap-5" data-ph-mask>
      <header>
        <h2 className="font-semibold text-base tracking-tight">Subscription</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your plan, usage and payment method.
        </p>
      </header>
      <Suspense fallback={<BillingDashboardSkeleton />}>
        <BillingDashboard initialBilling={initialBilling} />
      </Suspense>
    </section>
  );
}
