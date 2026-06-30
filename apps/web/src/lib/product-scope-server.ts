import { cookies } from "next/headers";
import { normalizeScope, PRODUCT_COOKIE } from "@/lib/product-scope";

// Server-side resolution of the active product scope for a route's RSC render.
// The URL param (an explicit, shareable deep-link) wins; otherwise the persisted
// cookie carries the sticky scope. Returns `undefined` for "all products" so it
// drops straight into the existing `productId?: string` query-key plumbing.
export async function resolveServerScope(
  urlProduct?: string,
): Promise<string | undefined> {
  if (normalizeScope(urlProduct)) return urlProduct;
  const cookieStore = await cookies();
  return normalizeScope(cookieStore.get(PRODUCT_COOKIE)?.value) ?? undefined;
}
