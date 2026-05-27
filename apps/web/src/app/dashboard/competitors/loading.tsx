import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeadSkeleton,
  TableSkeleton,
} from "@/components/dashboard/skeletons";
import { Card } from "@/components/ui/card";

export default function CompetitorsLoading() {
  return (
    <div className="space-y-[22px]" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <Card className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-5 py-4 flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </Card>
      <div className="flex items-center gap-2 flex-wrap">
        <Skeleton className="h-8 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-48" />
      </div>
      <TableSkeleton rows={6} columns={6} />
    </div>
  );
}
