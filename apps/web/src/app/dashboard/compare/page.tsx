import { CompareView } from "@/components/dashboard/compare-view";
import { getCompareData } from "@/lib/api-server";

export default async function ComparePage() {
  // Best-effort server prefetch of the picker inputs; null falls back to the
  // client fetch inside CompareView.
  const initialRaw = await getCompareData();
  return <CompareView initialRaw={initialRaw} />;
}
