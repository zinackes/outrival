import { DiscoveryView } from "./discovery-view";
import { getDiscoveryData } from "@/lib/api-server";

export default async function DiscoveryPage() {
  // Best-effort server prefetch of the "new" queue + staleness; null falls back
  // to the client fetches inside DiscoveryView.
  const initialData = await getDiscoveryData();
  return <DiscoveryView initialData={initialData} />;
}
