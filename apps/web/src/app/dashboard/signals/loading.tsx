import { Skeleton } from "@/components/ui/skeleton";
import { ListRowsSkeleton, CardBlockSkeleton } from "@/components/dashboard/skeletons";

// Signals feed is the most-visited page and its master-detail shape is distinctive,
// so it overrides the generic dashboard skeleton to keep the skeleton→content shift
// minimal: filter row + list column (master) + sticky detail card on desktop.
export default function SignalsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-5">
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      {/* filter / sort toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ListRowsSkeleton rows={6} />
        <div className="hidden lg:block">
          <CardBlockSkeleton height={420} />
        </div>
      </div>
    </div>
  );
}
