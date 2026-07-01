import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MyProductView } from "./my-product-view";
import { getMyProductData, getProductsList } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { myProductQuery, myProductChangesQuery } from "@/lib/queries";

export default async function MyProductPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // patch-28 — "Products" in the rail opens a product's detail page. Honour the active
  // scope (URL ?product= override wins, else the persisted cookie) so a non-primary
  // selection isn't silently reverted to the primary; fall back to the primary, then to
  // the legacy self view if the products list can't be fetched (best-effort).
  const { product: urlProduct } = await searchParams;
  const list = await getProductsList();
  if (list) {
    const active = list.products.filter((p) => p.status !== "archived");
    const scope = await resolveServerScope(urlProduct);
    const scoped = scope ? active.find((p) => p.id === scope) : null;
    const target = scoped ?? active.find((p) => p.isPrimary) ?? active[0];
    if (target) redirect(`/dashboard/products/${target.id}`);
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
