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

/**
 * The competitors roster, mid-load. One definition for both entrances: the SSR
 * `loading.tsx` and the client list's own pending branch used to draw two different
 * screens — a card grid on the server, a table on the client — so a cold visit
 * reflowed from one layout into the other before the data even arrived.
 *
 * Column widths track the real header (competitors-list.tsx `GRID`): a tick box, a
 * colour dot, the competitor, its latest move, then the columns that only appear as
 * the container widens.
 */
export function CompetitorsListSkeleton({ rows = 6 }: { rows?: number } = {}) {
  const grid =
    "grid items-center gap-x-3.5 px-2 " +
    "grid-cols-[1rem_0.625rem_minmax(0,1.15fr)_minmax(0,1.6fr)_1.75rem] " +
    "@2xl:grid-cols-[1rem_0.625rem_minmax(0,1.15fr)_minmax(0,1.7fr)_7rem_1.75rem] " +
    "@4xl:grid-cols-[1rem_0.625rem_minmax(0,1.15fr)_minmax(0,1.75fr)_7rem_9rem_1.75rem] " +
    "@5xl:grid-cols-[1rem_0.625rem_minmax(0,1.15fr)_minmax(0,1.8fr)_7rem_4rem_9rem_1.75rem]";
  return (
    <div className="@container">
      <div className={`${grid} border-b border-border pb-2`}>
        <Skeleton className="size-3.5 rounded-sm" />
        <span />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="hidden h-2.5 w-14 @2xl:block" />
        <Skeleton className="hidden h-2.5 w-12 @5xl:block" />
        <Skeleton className="hidden h-2.5 w-16 @4xl:block" />
        <span />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${grid} h-[3.75rem] border-b border-border last:border-b-0`}>
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="size-2.5 rounded-full" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3" style={{ width: `${70 - (i % 3) * 12}%` }} />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="hidden h-5 w-16 @2xl:block" />
          <Skeleton className="hidden h-3 w-8 @5xl:block" />
          <div className="hidden flex-col gap-1.5 @4xl:flex">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
          <span />
        </div>
      ))}
    </div>
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
