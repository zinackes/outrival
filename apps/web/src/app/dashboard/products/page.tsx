import { MyProductView } from "./my-product-view";
import { getMyProductData } from "@/lib/api-server";

export default async function MyProductPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside
  // MyProductView (which also drives scan polling).
  const initialData = await getMyProductData();
  return <MyProductView initialData={initialData} />;
}
