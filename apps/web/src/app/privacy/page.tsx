import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Outrival handles your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <DocPage
      title="Privacy Policy"
      updated="June 2026"
      intro="Outrival is built in Paris and hosted in the EU. The full policy is being finalized; the summary below reflects current practice."
    >
      <h2>What we store</h2>
      <p>
        Your account details, the competitors and sources you configure, and the
        signals and digests we generate from public competitor data. We don&apos;t
        sell personal data.
      </p>
      <h2>Where it lives</h2>
      <p>
        Data is stored on EU infrastructure. Captured snapshots are kept on
        object storage and retained according to your plan&apos;s retention window.
      </p>
      <h2>Your rights</h2>
      <p>
        You can export or permanently delete your workspace and all associated
        data at any time from settings. To exercise any GDPR right, email{" "}
        <a href="mailto:hello@outrival.io">hello@outrival.io</a>.
      </p>
    </DocPage>
  );
}
