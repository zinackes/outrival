import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { BillingDashboard } from "@/components/outrival/billing-dashboard";
import { BillingDashboardSkeleton } from "./billing-skeleton";
import { getBillingData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { billingQuery } from "@/lib/queries";

export default async function BillingPage() {
  // Best-effort server seed; null → BillingDashboard's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getBillingData();
  if (initial) queryClient.setQueryData(billingQuery().queryKey, initial);
  return (
    <section className="flex flex-col gap-5" data-ph-mask>
      <header>
        <h2 className="font-semibold text-base tracking-tight">Subscription</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your plan, usage and payment method.
        </p>
      </header>
      <Suspense fallback={<BillingDashboardSkeleton />}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <BillingDashboard />
        </HydrationBoundary>
      </Suspense>
    </section>
  );
}
