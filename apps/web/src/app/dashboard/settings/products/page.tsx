import { ProductsSettings } from "@/components/outrival/products-settings";
import { getProductsSettingsData } from "@/lib/api-server";

export default async function ProductsSettingsPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside the
  // component.
  const initialData = await getProductsSettingsData();
  return <ProductsSettings initialData={initialData} />;
}
