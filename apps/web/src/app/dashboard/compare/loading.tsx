import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/dashboard/skeletons";

// Compare is a header + picker inputs (products / competitors) + a comparison matrix.
// Overrides the generic card grid so the table shape matches the live matrix.
export default function CompareLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5">
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-40 rounded-md" />
        ))}
      </div>
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
