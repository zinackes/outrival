import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-9" aria-busy="true" aria-live="polite">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-56 mb-2" />
          <Skeleton className="h-3.5 w-80" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      {/* KPI strip — banded surface cells (no box), matching the live layout. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border-y border-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface px-5 py-4 flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-[70%]" />
          </div>
        ))}
      </div>

      {/* Category band */}
      <div>
        <Skeleton className="h-2.5 w-40 mb-2" />
        <Skeleton className="h-2 w-full rounded-sm" />
      </div>

      {/* Recent signals section */}
      <div>
        <div className="flex items-center justify-between border-b border-border pb-2.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-1.5 py-3">
              <Skeleton className="h-2 w-2 rounded-full mt-1.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-[80%]" />
                <Skeleton className="h-3 w-[55%]" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Competitors section */}
      <div>
        <div className="flex items-center justify-between border-b border-border pb-2.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-1.5 py-3">
              <Skeleton className="h-6 w-6 rounded-md" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-20 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
