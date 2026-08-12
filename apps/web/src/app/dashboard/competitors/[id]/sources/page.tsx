import { ALL_CONFIGURABLE_SOURCES, type SourceType } from "@outrival/shared";
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
 *
 * `?source=<type>` is how a CTA that already knows which source it is about hands
 * that over: read here rather than through `useSearchParams` so the value arrives
 * as a plain prop, with no client hook forcing a Suspense boundary on the view. A
 * value outside the configurable catalog (a custom monitor, a stale link) resolves
 * to null and the page opens the way it always did.
 */
export default async function CompetitorSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { id } = await params;
  const { source } = await searchParams;
  const targetSource =
    source && (ALL_CONFIGURABLE_SOURCES as readonly string[]).includes(source)
      ? (source as SourceType)
      : null;
  return <SourcesView id={id} targetSource={targetSource} />;
}
