import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDigestDetailData } from "@/lib/api-server";
import { DigestSheet } from "@/components/outrival/digest-sheet";
import { PrintControls } from "./print-controls";

// A private document, never a search result.
export const metadata: Metadata = {
  title: "Competitive brief",
  robots: { index: false, follow: false },
};

/**
 * The printable brief.
 *
 * Deliberately outside /dashboard: the sheet is a document, so it must not inherit
 * the app shell's sidebar, topbar and banners. Authorization is the API's: the
 * request carries the session cookie and the digests route is org-scoped, so a
 * digest belonging to someone else resolves to nothing and 404s here.
 */
export default async function BriefPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getDigestDetailData(id);
  if (!detail?.digest) notFound();

  return (
    <div className="min-h-dvh bg-background">
      <PrintControls
        backHref={`/dashboard/digests/${detail.digest.id}`}
        auto={query.print === "1"}
      />
      <DigestSheet digest={detail.digest} />
    </div>
  );
}
