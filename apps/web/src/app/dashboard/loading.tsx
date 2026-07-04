import { Skeleton } from "@/components/ui/skeleton";
import { GridCardsSkeleton } from "@/components/dashboard/skeletons";

// Generic dashboard route-loading boundary. Sits just inside the dashboard layout,
// so navigating to ANY nested page that lacks its own loading.tsx swaps to this
// skeleton instantly instead of freezing while the server component awaits its
// data fetch (cookie-forwarded API round-trip). Pages with a distinctive layout
// (signals, competitors, settings) ship a closer loading.tsx that overrides this.
// No outer padding — DashboardShell's #main-content already pads the slot.
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <GridCardsSkeleton cards={6} />
    </div>
  );
}
