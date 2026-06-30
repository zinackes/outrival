import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { SignalsView } from "@/components/dashboard/signals-view";
import { getSignalsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { signalsQuery } from "@/lib/queries";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const product = await resolveServerScope(
    typeof sp.product === "string" ? sp.product : undefined,
  );
  const sort = sp.sort === "recent" ? "recent" : "threat";
  // Seed the cache under the same key SignalsView reads (product + sort). Best-effort:
  // null → its useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getSignalsData({ productId: product, sort });
  if (initial) {
    queryClient.setQueryData(
      signalsQuery({ limit: 200, productId: product, sort }).queryKey,
      initial,
    );
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SignalsView />
    </HydrationBoundary>
  );
}
