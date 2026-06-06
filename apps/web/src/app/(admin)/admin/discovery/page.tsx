import { adminFetch } from "../_lib/server";
import { DiscoveryView } from "./view";
import type { AdminDiscovery } from "@/lib/api";

export default async function DiscoveryPage() {
  const data = await adminFetch<AdminDiscovery>("/api/admin/discovery");
  return <DiscoveryView data={data} />;
}
