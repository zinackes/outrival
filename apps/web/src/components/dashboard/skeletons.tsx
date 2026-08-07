import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function CardBlockSkeleton({
  height = 200,
  withHeader = true,
}: {
  height?: number;
  withHeader?: boolean;
} = {}) {
  return (
    <Card className="overflow-hidden">
      {withHeader && (
        <div className="px-4 py-3 border-b border-border">
          <Skeleton className="h-4 w-36 mb-1.5" />
          <Skeleton className="h-3 w-48" />
        </div>
      )}
      <div className="p-5 flex flex-col gap-3" style={{ minHeight: height }}>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[85%]" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
    </Card>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 5,
}: { rows?: number; columns?: number } = {}) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-background grid items-center px-3.5 py-3 border-b border-border gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      <div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid items-center px-3.5 py-3 border-b border-border last:border-b-0 gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className="h-3.5"
                style={{ width: `${60 + ((r + c) % 4) * 10}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ListRowsSkeleton({ rows = 5 }: { rows?: number } = {}) {
  return (
    <Card className="overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="p-6 border-b border-border last:border-b-0 flex flex-col gap-3"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-5 w-20 rounded" />
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3.5 w-28" />
            <span className="flex-1" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-4 w-[90%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      ))}
    </Card>
  );
}

export function GridCardsSkeleton({
  cards = 6,
  minWidth = 280,
  cardHeight = 200,
}: { cards?: number; minWidth?: number; cardHeight?: number } = {}) {
  return (
    <div
      className="grid gap-3.5"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="p-5 flex flex-col gap-3" style={{ minHeight: cardHeight }}>
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32 mb-1.5" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-3 w-full mt-2" />
          <Skeleton className="h-3 w-[80%]" />
          <div className="pt-3 mt-auto border-t border-border flex items-end justify-between">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-2.5 w-16" />
            </div>
            <Skeleton className="h-4 w-12" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number } = {}) {
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-2.5 w-56" />
        </div>
      ))}
    </div>
  );
}

/**
 * The three shapes a settings section loads in (OUT-38).
 *
 * Settings used to ship seven different skeletons — `FormSkeleton(2)`,
 * `FormSkeleton(3)`, five `h-12` bars, two `h-16` bars, an `h-4` over an `h-24`,
 * a bespoke billing one — none of which matched the section it stood in for, so
 * the page reflowed on every load. Sections come in three shapes; so do these.
 */

/** A list of label + control rows: notification routing, quiet hours, sources. */
export function SettingRowsSkeleton({ rows = 4 }: { rows?: number } = {}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-5 border-b border-border py-3.5 last:border-b-0"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-[70%]" />
          </div>
          <Skeleton className="h-8 w-40 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A bordered card of icon + two-line rows: sessions, products, profiles. */
export function SettingCardRowsSkeleton({ rows = 3 }: { rows?: number } = {}) {
  return (
    <Card className="overflow-hidden p-0">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-2.5 w-52" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
        </div>
      ))}
    </Card>
  );
}

/** A list of metered rows: usage limits, anything with a Progress under it. */
export function SettingMetersSkeleton({ rows = 4 }: { rows?: number } = {}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border py-3.5 last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="mt-2.5 h-1.5 w-full rounded-sm" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number } = {}) {
  return (
    <Card className="p-4">
      <Skeleton className="h-3 w-32 mb-3" />
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}
