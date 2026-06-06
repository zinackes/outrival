import { adminFetch } from "../_lib/server";
import { DeliveryView } from "./view";
import type { AdminDelivery } from "@/lib/api";

export default async function DeliveryPage() {
  const data = await adminFetch<AdminDelivery>("/api/admin/delivery");
  return <DeliveryView data={data} />;
}
