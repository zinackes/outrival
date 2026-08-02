import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { InProgressReader } from "@/components/dashboard/in-progress-reader";
import { getDigestInProgressData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { digestInProgressDetailQuery } from "@/lib/queries";

// A static segment, so it wins over /dashboard/digests/[id] and no digest id can
// ever be shadowed by it (ids are uuids).
export default async function DigestInProgressPage() {
  // Best-effort server seed; null → InProgressReader's useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getDigestInProgressData(true);
  if (initial) {
    queryClient.setQueryData(digestInProgressDetailQuery().queryKey, initial.inProgress);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InProgressReader />
    </HydrationBoundary>
  );
}
