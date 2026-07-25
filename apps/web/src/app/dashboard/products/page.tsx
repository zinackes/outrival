import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { MyProductView } from "./my-product-view";
import { ProductsPortfolio } from "./products-portfolio";
import { getMyProductData, getProductsList } from "@/lib/api-server";
import { makeServerQueryClient } from "@/lib/server-query";
import { resolveServerScope } from "@/lib/product-scope-server";
import { myProductQuery, myProductChangesQuery, productsSettingsQuery } from "@/lib/queries";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  // Products opens on whatever the active scope means.
  //
  //   scoped to a product  → that product's page (the sidebar switcher's pick)
  //   one product only     → its page, since a portfolio of one is a worse page
  //   all products         → the portfolio
  //
  // It used to redirect to the primary product unconditionally, which quietly
  // pinned a workspace scoped to "All products" onto one SKU: the detail page
  // writes the scope back (sidebar.tsx), so opening Products changed what every
  // other page showed. "All products" had no page of its own to open.
  const { product: urlProduct } = await searchParams;
  const list = await getProductsList();
  if (list) {
    const active = list.products.filter((p) => p.status !== "archived");
    const scope = await resolveServerScope(urlProduct);
    const scoped = scope ? active.find((p) => p.id === scope) : null;
    if (scoped) redirect(`/dashboard/products/${scoped.id}`);
    if (active.length === 1) redirect(`/dashboard/products/${active[0]!.id}`);
    if (active.length > 1) {
      const queryClient = makeServerQueryClient();
      queryClient.setQueryData(productsSettingsQuery().queryKey, list);
      return (
        <HydrationBoundary state={dehydrate(queryClient)}>
          <ProductsPortfolio />
        </HydrationBoundary>
      );
    }
  }

  // No products at all, or the list could not be fetched: seed the primary self +
  // its pending changes and render the legacy view.
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
