import { Skeleton } from "@/components/ui/skeleton";
import { CardBlockSkeleton } from "@/components/dashboard/skeletons";

// Digests is a header + a vertical stack of weekly digest cards. Overrides the generic
// card grid so the stacked-block shape matches and the skeleton→content shift is minimal.
export default function DigestsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5">
        <Skeleton className="h-7 w-36 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardBlockSkeleton key={i} height={120} />
        ))}
      </div>
    </div>
  );
}
