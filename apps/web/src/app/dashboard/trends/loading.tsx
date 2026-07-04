import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton } from "@/components/dashboard/skeletons";

// Trends is a header + date-range control + a grid of charts. Overrides the generic
// card-grid skeleton so the chart shape matches and the skeleton→content shift is minimal.
export default function TrendsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <ChartSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
