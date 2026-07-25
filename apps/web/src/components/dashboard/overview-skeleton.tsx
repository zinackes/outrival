import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Overview's own loading shape, block by block.
 *
 * The page used to render a generic dashboard skeleton whose layout no longer
 * matched anything on screen, so the content jumped when it landed. This mirrors
 * the real blocks (masthead, lead plus rail, mover tiles, decision queue), which
 * is the whole point of a skeleton: reserve the space the answer will take.
 */
export function OverviewSkeleton() {
  return (
    <div className="space-y-9" aria-busy="true" aria-live="polite">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 md:mb-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      {/* The lead + its rail */}
      <div className="grid overflow-hidden rounded-lg border border-border-strong bg-card lg:grid-cols-[minmax(0,1fr)_264px]">
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-3.5 w-64" />
          <Skeleton className="h-6 w-[80%]" />
          <Skeleton className="h-6 w-[55%]" />
          <Skeleton className="h-3.5 w-[70%]" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="flex flex-col border-border bg-background-2 max-lg:flex-row max-lg:border-t max-sm:flex-col lg:border-l">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-1 flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 max-lg:border-b-0 max-lg:border-r max-lg:last:border-r-0 max-sm:border-b max-sm:border-r-0"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Who moved */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <Skeleton className="h-4 w-[70%]" />
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-2.5 w-[85%]" />
            </div>
          ))}
        </div>
      </div>

      {/* Needs a decision */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
            >
              <Skeleton className="h-4 w-2.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-[70%]" />
                <Skeleton className="h-2.5 w-40" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
