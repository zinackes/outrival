import { CompetitorDetailView } from "./competitor-detail-view";
import { getCompetitorDetailData } from "@/lib/api-server";

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Best-effort server prefetch; null falls back to the client fetch inside the
  // detail view (which also drives polling + in-progress scrape tracking).
  const initialData = await getCompetitorDetailData(id);
  return <CompetitorDetailView id={id} initialData={initialData} />;
}
