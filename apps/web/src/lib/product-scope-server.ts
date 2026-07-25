import { cookies } from "next/headers";
import { ALL_PRODUCTS, normalizeScope, PRODUCT_COOKIE } from "@/lib/product-scope";

// Server-side resolution of the active product scope for a route's RSC render.
// The URL param (an explicit, shareable deep-link) wins; otherwise the persisted
// cookie carries the sticky scope. Returns `undefined` for "all products" so it
// drops straight into the existing `productId?: string` query-key plumbing.
export async function resolveServerScope(
  urlProduct?: string,
): Promise<string | undefined> {
  if (normalizeScope(urlProduct)) return urlProduct;
  // `?product=all` is the URL saying "every product", which has to beat the
  // cookie like any other inbound override. Without this branch it collapsed to
  // the same value as an absent param, the cookie won, and a link to the whole
  // workspace reopened whichever product was last scoped.
  if (urlProduct === ALL_PRODUCTS) return undefined;
  const cookieStore = await cookies();
  return normalizeScope(cookieStore.get(PRODUCT_COOKIE)?.value) ?? undefined;
}
