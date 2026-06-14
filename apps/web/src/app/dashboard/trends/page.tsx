import { TrendsView } from "@/components/dashboard/trends-view";
import { getTrendsData } from "@/lib/api-server";

export default async function TrendsPage() {
  // Best-effort server prefetch of the default 90d summary; null falls back to
  // the client fetch inside TrendsView.
  const initialSummary = await getTrendsData();
  return <TrendsView initialSummary={initialSummary} />;
}
