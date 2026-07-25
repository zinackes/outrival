import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DigestReader } from "@/components/dashboard/digest-reader";
import { getDigestDetailData, getDigestsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { digestDetailQuery, digestsQuery } from "@/lib/queries";

export default async function DigestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Best-effort server seed; null → DigestReader's useQuery fetches client-side
  // (and renders a graceful not-found state on a real miss). The list rides along
  // because the reader's previous/next issue links are read out of it.
  const queryClient = makeServerQueryClient();
  const [initial, list] = await Promise.all([getDigestDetailData(id), getDigestsData()]);
  if (initial) queryClient.setQueryData(digestDetailQuery(id).queryKey, initial);
  if (list) queryClient.setQueryData(digestsQuery().queryKey, list);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DigestReader id={id} />
    </HydrationBoundary>
  );
}
