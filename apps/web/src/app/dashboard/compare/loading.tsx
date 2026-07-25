import { Skeleton } from "@/components/ui/skeleton";

// Compare is a head, the compared set as chips, the verdict, then two columns of
// lens rows. Mirrors that shape so the first paint settles into what lands rather
// than dissolving a table.
function LensSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="border-border flex flex-col gap-1.5 border-b pb-2.5">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-52" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[9rem_minmax(0,1fr)_3rem] items-center gap-3 py-1">
          <div className="flex items-center gap-2">
            <Skeleton className="size-[22px] rounded-[5px]" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <Skeleton className="h-2 w-full rounded-[3px]" />
          <Skeleton className="h-3 w-10 justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export default function CompareLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      <div className="border-border flex flex-wrap items-center gap-1.5 border-b pb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-32 rounded-md" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full max-w-[46ch]" />
          <Skeleton className="h-4 w-full max-w-[52ch]" />
          <Skeleton className="h-4 w-full max-w-[38ch]" />
        </div>
        <div className="flex flex-col gap-3 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-x-10">
        <LensSkeleton />
        <LensSkeleton />
      </div>
    </div>
  );
}
