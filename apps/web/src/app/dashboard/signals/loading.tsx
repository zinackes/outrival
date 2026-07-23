import { Skeleton } from "@/components/ui/skeleton";
import { ListRowsSkeleton } from "@/components/dashboard/skeletons";

// Signals is the most-visited page and its workspace shape is distinctive, so it
// overrides the generic dashboard skeleton: the list column with its own head,
// and the detail column beside it — the frame the content lands in.
export default function SignalsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex h-full min-h-0">
      <div className="flex w-full min-w-0 flex-col border-border lg:w-[400px] lg:shrink-0 lg:border-r">
        <div className="shrink-0 space-y-2.5 border-b border-border px-4 py-3.5">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-8 w-full rounded-md" />
          <div className="flex gap-2 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-14" />
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-1.5">
          <ListRowsSkeleton rows={8} />
        </div>
      </div>
      <div className="hidden min-w-0 flex-1 flex-col lg:flex">
        <div className="shrink-0 border-b border-border px-6 py-3">
          <Skeleton className="h-6 w-56" />
        </div>
        <div className="mx-auto w-full max-w-[820px] space-y-4 px-8 py-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-28 w-full rounded-md" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
