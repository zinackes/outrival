import { Skeleton } from "@/components/ui/skeleton";
import { CardBlockSkeleton } from "@/components/dashboard/skeletons";

export default function CompetitorDetailLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <Skeleton className="h-4 w-16 mb-4" />

      <div className="mb-6">
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-3" />
        <Skeleton className="h-3 w-72" />
      </div>

      <Skeleton className="h-20 w-full mb-6" />

      <div className="mb-6">
        <Skeleton className="h-3 w-24 mb-3" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>

      <div className="flex gap-2 border-b border-border pb-2 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28" />
        ))}
      </div>

      <CardBlockSkeleton height={240} withHeader={false} />
    </div>
  );
}
