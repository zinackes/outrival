import { RecapWrapped } from "@/components/dashboard/recap-wrapped";

// Monthly "Competitive Recap" — the Wrapped view (Lever 9). `?month=YYYY-MM` pins a
// month; default is the last complete one. The email teaser links here.
export default async function RecapPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  return <RecapWrapped month={month} />;
}
