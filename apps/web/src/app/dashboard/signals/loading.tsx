import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeadSkeleton,
  ListRowsSkeleton,
} from "@/components/dashboard/skeletons";

export default function SignalsLoading() {
  return (
    <div className="space-y-[22px]" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <div className="flex items-center gap-2 flex-wrap">
        <Skeleton className="h-8 w-[260px]" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-48" />
      </div>
      <ListRowsSkeleton rows={5} />
    </div>
  );
}
