import { Skeleton } from "@/components/ui/skeleton";
import { CardBlockSkeleton } from "@/components/dashboard/skeletons";

// Digests is a masthead, a toolbar, one open lead brief, then a run of earlier
// issues. Matching that shape keeps the skeleton→content shift small.
export default function DigestsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5">
      <div>
        <Skeleton className="h-7 w-36 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-56" />
      </div>
      <CardBlockSkeleton height={196} />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border pb-3.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
