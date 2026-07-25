import { Skeleton } from "@/components/ui/skeleton";

// Trends is a header, a verdict card, then a stack of movements (heading, chart,
// rows). Mirrors that shape so the skeleton to content shift is minimal.
export default function TrendsLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="mb-2 h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <Skeleton className="h-[148px] w-full rounded-lg" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
