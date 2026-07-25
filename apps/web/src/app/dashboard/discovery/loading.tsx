import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/dashboard/skeletons";

// Discovery opens on a reading, a rail of numbers and a ranked list, so the fallback
// holds that shape rather than the generic card grid: a skeleton that resolves into a
// different layout reads as a jump.
// No outer padding — DashboardShell's #main-content already pads the slot.
export default function DiscoveryLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5">
      <div>
        <Skeleton className="mb-2 h-7 w-44" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-3 border-b border-border pb-[18px]">
        <Skeleton className="h-5 w-[38rem] max-w-full" />
        <Skeleton className="h-3.5 w-[30rem] max-w-full" />
        <div className="flex gap-6 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-8 w-64" />
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
