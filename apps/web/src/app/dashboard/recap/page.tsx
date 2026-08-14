import { RecapWrapped } from "@/components/dashboard/recap-wrapped";

// Monthly "Competitive Recap" — the Wrapped view (Lever 9). `?month=YYYY-MM` pins a
// month; default is the last complete one. The email teaser links here.
//
// A `month` that isn't a real one is dropped rather than forwarded (OUT-189): the API
// falls back to the last complete month anyway, and the deck states which month it is
// showing, so the reader sees a labelled recap instead of an error for a typo.
export default async function RecapPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const pinned = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  return <RecapWrapped month={pinned} />;
}
