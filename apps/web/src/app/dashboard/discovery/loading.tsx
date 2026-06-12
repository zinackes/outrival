import {
  PageHeadSkeleton,
  GridCardsSkeleton,
} from "@/components/dashboard/skeletons";

export default function CandidatesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeadSkeleton />
      <GridCardsSkeleton cards={6} minWidth={320} cardHeight={220} />
    </div>
  );
}
