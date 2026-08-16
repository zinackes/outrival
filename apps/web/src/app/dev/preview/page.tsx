import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewClient } from "./preview-client";

// Dev-only preview surface for the versioned product screenshots
// (scripts/capture-product-shots.ts). Renders the REAL dashboard components against
// sample data, with no auth and no API, so the marketing captures always reflect the
// current UI. 404s in production, exactly like the other /dev tools.
export const metadata: Metadata = {
  title: "Product preview (dev)",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ shot?: string }>;
}) {
  // Reachable in dev, or on a deployment that explicitly opts in
  // (PRODUCT_PREVIEW_ENABLED=1) so the marketing captures can be regenerated
  // against the real UI, then turns the flag back off.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.PRODUCT_PREVIEW_ENABLED !== "1"
  ) {
    notFound();
  }
  const { shot } = await searchParams;
  const known =
    shot === "signal" || shot === "app" ? shot : ("overview" as const);
  return <PreviewClient shot={known} />;
}
