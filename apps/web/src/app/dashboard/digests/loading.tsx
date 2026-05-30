import {
  PageHeadSkeleton,
  TableSkeleton,
} from "@/components/dashboard/skeletons";

export default function DigestsLoading() {
  return (
    <div className="space-y-[22px]" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <TableSkeleton rows={5} columns={5} />
    </div>
  );
}
