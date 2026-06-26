import { SectoralFeed } from "@/components/dashboard/sectoral-feed";
import { getSectoralData } from "@/lib/api-server";

export default async function SectorPage() {
  // Best-effort server prefetch of the default page; null falls back to the
  // client fetch inside SectoralFeed.
  const data = await getSectoralData();
  return (
    <SectoralFeed
      initialSignals={data?.signals ?? null}
      initialEligibility={data?.eligibility ?? null}
    />
  );
}
