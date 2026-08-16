import { Skeleton } from "@/components/ui/skeleton";
import { CompetitorsListSkeleton } from "@/components/dashboard/skeletons";

// Competitors list — header + toolbar + the roster. Overrides the generic dashboard
// skeleton so the toolbar row is present, and shares CompetitorsListSkeleton with the
// list's own pending branch: this used to draw a card grid where the client drew a
// table, so a cold visit changed layout twice before showing a single competitor.
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
      <CompetitorsListSkeleton />
    </div>
  );
}
