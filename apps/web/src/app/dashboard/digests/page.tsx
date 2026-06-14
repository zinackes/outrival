import { DigestsView } from "@/components/dashboard/digests-view";
import { getDigestsData } from "@/lib/api-server";

export default async function DigestsPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside
  // DigestsView.
  const initialDigests = await getDigestsData();
  return <DigestsView initialDigests={initialDigests} />;
}
