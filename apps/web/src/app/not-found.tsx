import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/landing/doc-page";

// Next's built-in 404 is a bare centred string on a white page: no nav, no
// footer, no way back into the site, and nothing that says which product the
// reader just landed in. Every other failure surface here keeps its chrome
// (dashboard/error.tsx, ListError, SettingsError), so this one does too — it is
// the same DocPage shell the legal and marketing pages run (`ux:03`).
//
// This file also catches a `notFound()` thrown outside /dashboard, and it is the
// boundary an unmatched URL falls to whatever the segment.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <DocPage
      title="Page not found"
      intro="That address doesn't lead anywhere. It may have moved, or the link that brought you here may be out of date."
    >
      <p>
        Head back to the <Link href="/">home page</Link>, open your{" "}
        <Link href="/dashboard">dashboard</Link>, or read the{" "}
        <Link href="/docs">documentation</Link>.
      </p>
      <p>
        If a link on this site sent you here, tell us at{" "}
        <a href="mailto:hello@outrival.app">hello@outrival.app</a> and we&apos;ll fix it.
      </p>
    </DocPage>
  );
}
