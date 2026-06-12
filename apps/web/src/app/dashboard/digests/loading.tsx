import {
  PageHeadSkeleton,
  TableSkeleton,
} from "@/components/dashboard/skeletons";

export default function DigestsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <TableSkeleton rows={5} columns={5} />
    </div>
  );
}
