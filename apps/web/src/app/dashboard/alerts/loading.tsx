import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { PageHeadSkeleton } from "@/components/dashboard/skeletons";

export default function AlertsLoading() {
  return (
    <div className="space-y-[22px]" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <Card className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <Skeleton className="h-3 w-20 mr-2" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-32 rounded-md" />
        ))}
        <div className="flex-1" />
        <Skeleton className="h-3 w-40" />
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
          <div>
            <Skeleton className="h-4 w-24 mb-1.5" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
        <div className="px-6 py-14 text-center flex flex-col items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      </Card>
    </div>
  );
}
