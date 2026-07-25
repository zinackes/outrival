import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/dashboard/skeletons";

// Products opens on the portfolio, or redirects straight to a single product, so
// the fallback is table-shaped rather than the overview-shaped root skeleton.
export default function ProductsLoading() {
  return (
    <div className="xl:px-6 2xl:px-12">
      <div className="mb-6 flex flex-col gap-2 md:mb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <TableSkeleton rows={3} columns={5} />
    </div>
  );
}
