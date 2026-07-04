import { Skeleton } from "@/components/ui/skeleton";
import { GridCardsSkeleton } from "@/components/dashboard/skeletons";

// Competitors list — header + toolbar + a card grid. Overrides the generic dashboard
// skeleton so the toolbar row is present and the grid density matches the real list.
export default function CompetitorsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-44 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-md" />
        ))}
      </div>
      <GridCardsSkeleton cards={6} />
    </div>
  );
}
