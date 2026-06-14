import { CompetitorsList } from "@/components/dashboard/competitors-list";
import { getCompetitorsData } from "@/lib/api-server";

export default async function CompetitorsPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside
  // CompetitorsList (which also keeps polling every 30s regardless).
  const initialCompetitors = await getCompetitorsData();
  return <CompetitorsList initialCompetitors={initialCompetitors} />;
}
