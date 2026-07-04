import { Skeleton } from "@/components/ui/skeleton";
import { GridCardsSkeleton } from "@/components/dashboard/skeletons";

// Neutral header + card-grid skeleton. Shared fallback for dashboard routes whose
// live layout is a grid (or that render fast client shells), so they don't inherit
// the overview-shaped root loading.tsx. Routes with a distinctive layout (signals,
// competitors, trends, activity, compare, digests) ship a closer loading.tsx.
// No outer padding — DashboardShell's #main-content already pads the slot.
export default function GenericDashboardSkeleton() {
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
