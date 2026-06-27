import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MyProductView } from "./my-product-view";
import { getMyProductData } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { myProductQuery, myProductChangesQuery } from "@/lib/queries";

export default async function MyProductPage() {
  // Seed the product + its pending changes. Best-effort: null → the client
  // useQueries fetch on mount (which also drives scan polling).
  const queryClient = makeServerQueryClient();
  const initial = await getMyProductData();
  if (initial) {
    queryClient.setQueryData(myProductQuery().queryKey, initial.product);
    queryClient.setQueryData(myProductChangesQuery().queryKey, initial.changes);
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MyProductView />
    </HydrationBoundary>
  );
}
