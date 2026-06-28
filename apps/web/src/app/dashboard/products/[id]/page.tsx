import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ProductDetailView } from "./product-detail-view";
import { getMyProductData, getProductDetailData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import {
  myProductQuery,
  myProductChangesQuery,
  productDetailQuery,
} from "@/lib/queries";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Seed the product detail (row + linked competitors) and the rich self detail
  // (profile/pricing/jobs + pending changes), all scoped to this product. Best-effort:
  // null → the client useQueries fetch on mount (which also drives the scan poller).
  const queryClient = makeServerQueryClient();
  const [detail, mp] = await Promise.all([
    getProductDetailData(id),
    getMyProductData(id),
  ]);
  if (detail) queryClient.setQueryData(productDetailQuery(id).queryKey, detail);
  if (mp) {
    queryClient.setQueryData(myProductQuery(id).queryKey, mp.product);
    queryClient.setQueryData(myProductChangesQuery(id).queryKey, mp.changes);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductDetailView productId={id} />
    </HydrationBoundary>
  );
}
