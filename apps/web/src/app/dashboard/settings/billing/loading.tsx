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
    <div className="flex flex-col gap-8">
      <Card className="px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <div className="flex flex-col gap-1.5 min-w-[180px]">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Skeleton className="h-5 w-32 mb-1.5" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-8 w-44" />
        </div>
        <Card className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
