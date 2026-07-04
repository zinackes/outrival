import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Activity is a header + source-health strip + a scrape timeline (dense rows). Overrides
// the generic card grid so the timeline shape matches and the skeleton→content shift is minimal.
export default function ActivityLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5">
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      {/* source-health strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
      {/* timeline */}
      <Card className="overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0"
          >
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-5 w-16 rounded ml-2" />
            <Skeleton className="h-3 w-20 ml-auto" />
          </div>
        ))}
      </Card>
    </div>
  );
}
