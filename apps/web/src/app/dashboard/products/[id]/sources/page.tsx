import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ProductSourcesView } from "./product-sources-view";
import { getProductDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { productDetailQuery } from "@/lib/queries";

export default async function ProductSourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Seed the product row (name + self-competitor id) so the sheet mounts without a
  // client roundtrip. Best-effort: null → the client query fetches on mount. The
  // monitor data itself stays client-fetched — it drives the scrape poller.
  const queryClient = makeServerQueryClient();
  const detail = await getProductDetailData(id);
  if (detail) queryClient.setQueryData(productDetailQuery(id).queryKey, detail);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductSourcesView productId={id} />
    </HydrationBoundary>
  );
}
