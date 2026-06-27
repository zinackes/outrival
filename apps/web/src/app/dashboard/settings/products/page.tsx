import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { ProductsSettings } from "@/components/outrival/products-settings";
import { getProductsSettingsData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { productsSettingsQuery } from "@/lib/queries";

export default async function ProductsSettingsPage() {
  // Best-effort server seed; null → ProductsSettings' useQuery fetches client-side.
  const queryClient = makeServerQueryClient();
  const initial = await getProductsSettingsData();
  if (initial) queryClient.setQueryData(productsSettingsQuery().queryKey, initial);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductsSettings />
    </HydrationBoundary>
  );
}
