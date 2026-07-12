import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "API (coming soon)",
  description: "The Outrival API is in development and not yet available.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <DocPage
      title="API — coming soon"
      intro="The Outrival API isn't available yet — it's still in development, and there are no live endpoints or keys today. Here's what it will do, and how to hear when it ships."
    >
      <h2>What it will do</h2>
      <p>
        Programmatic access to your signals, competitors, and digests, plus
        outbound webhooks for real-time delivery into your own systems.
      </p>
      <h2>Get notified at launch</h2>
      <p>
        Want to be first when the API opens up? Email{" "}
        <a href="mailto:hello@outrival.app">hello@outrival.app</a> and we&apos;ll
        let you know as soon as it&apos;s ready.
      </p>
    </DocPage>
  );
}
