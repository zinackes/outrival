import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MyProductView } from "./my-product-view";
import { getMyProductData, getProductsList } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { myProductQuery, myProductChangesQuery } from "@/lib/queries";

export default async function MyProductPage() {
  // patch-28 — "Products" in the rail opens the primary product's detail page. Redirect
  // there when we can resolve it; fall back to the legacy primary self view if the
  // products list can't be fetched (best-effort).
  const list = await getProductsList();
  if (list) {
    const active = list.products.filter((p) => p.status !== "archived");
    const primary = active.find((p) => p.isPrimary) ?? active[0];
    if (primary) redirect(`/dashboard/products/${primary.id}`);
  }

  // Fallback: seed the primary self + its pending changes and render the legacy view.
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
