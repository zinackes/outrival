import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ProductDetailView } from "./product-detail-view";
import { getMyProductData, getProductDetailData, getProductsList } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import {
  myProductQuery,
  myProductChangesQuery,
  productDetailQuery,
  productsListQuery,
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
  const [detail, mp, list] = await Promise.all([
    getProductDetailData(id),
    getMyProductData(id),
    // The roster the breadcrumb switcher and the lead's rail read from. The sidebar
    // fetches it too, but only after hydration, which would leave the lead's stats
    // and the switcher blank on first paint.
    getProductsList(),
  ]);
  if (detail) queryClient.setQueryData(productDetailQuery(id).queryKey, detail);
  if (mp) {
    queryClient.setQueryData(myProductQuery(id).queryKey, mp.product);
    queryClient.setQueryData(myProductChangesQuery(id).queryKey, mp.changes);
  }
  if (list) queryClient.setQueryData(productsListQuery().queryKey, list.products);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductDetailView productId={id} />
    </HydrationBoundary>
  );
}
