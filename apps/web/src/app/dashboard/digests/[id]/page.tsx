import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { DigestReader } from "@/components/dashboard/digest-reader";
import { getDigestDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { digestDetailQuery } from "@/lib/queries";

export default async function DigestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Best-effort server seed; null → DigestReader's useQuery fetches client-side
  // (and renders a graceful not-found state on a real miss).
  const queryClient = makeServerQueryClient();
  const initial = await getDigestDetailData(id);
  if (initial) queryClient.setQueryData(digestDetailQuery(id).queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DigestReader id={id} />
    </HydrationBoundary>
  );
}
