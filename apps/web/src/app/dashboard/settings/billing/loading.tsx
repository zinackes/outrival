import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function BillingLoading() {
  return (
    <section className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <header>
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </header>
      <BillingDashboardSkeleton />
    </section>
  );
}

export function BillingDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <Card className="overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex flex-col gap-5 border-t border-border p-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-1.5 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 [&>*]:bg-surface">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5 px-3.5 py-3">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <Skeleton className="h-5 w-32 mb-1.5" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-8 w-44" />
        </div>
        <Card className="p-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
