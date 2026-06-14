import { SignalsView } from "@/components/dashboard/signals-view";
import { getSignalsData } from "@/lib/api-server";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const product = typeof sp.product === "string" ? sp.product : undefined;
  const sort = sp.sort === "recent" ? "recent" : "threat";
  // Best-effort server prefetch matching the URL's fetch params; null falls back
  // to the client fetch inside SignalsView.
  const initialSignals = await getSignalsData({ productId: product, sort });
  return <SignalsView initialSignals={initialSignals} />;
}
