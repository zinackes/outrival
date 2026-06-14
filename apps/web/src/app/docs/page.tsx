import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "API Docs",
  description: "The Outrival API for Business-plan customers.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <DocPage
      title="API documentation"
      intro="The Outrival API is available on the Business plan. Full reference docs are in progress."
    >
      <h2>What you can do</h2>
      <p>
        Programmatic access to your signals, competitors, and digests, plus
        outbound webhooks for real-time delivery into your own systems.
      </p>
      <h2>Get early access</h2>
      <p>
        On the Business plan and want the API before the docs ship? Email{" "}
        <a href="mailto:hello@outrival.app">hello@outrival.app</a> and we&apos;ll set
        you up with a key and the current reference.
      </p>
    </DocPage>
  );
}
