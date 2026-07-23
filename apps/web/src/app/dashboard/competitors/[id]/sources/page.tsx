import { SourcesView } from "./sources-view";

/**
 * No server seed on purpose. This page is reached from the competitor page, whose
 * detail query (same key, 60s stale time) is already in the client cache — so the
 * view paints from memory the moment the route swaps. Awaiting the detail payload
 * here instead blocked the whole navigation on a second fetch of data the browser
 * already had, which is what made opening Sources feel slow.
 *
 * Landing here cold (direct URL) falls back to the view's own client fetch behind
 * its skeleton — one round-trip either way, just not a blocking one.
 */
export default async function CompetitorSourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SourcesView id={id} />;
}
