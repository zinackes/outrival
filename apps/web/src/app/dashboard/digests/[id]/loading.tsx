import { Skeleton } from "@/components/ui/skeleton";
import { CardBlockSkeleton } from "@/components/dashboard/skeletons";

export default function DigestDetailLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <Skeleton className="h-4 w-28" />
      <div>
        <Skeleton className="h-7 w-64 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <CardBlockSkeleton key={i} height={140} />
        ))}
      </div>
    </div>
  );
}
