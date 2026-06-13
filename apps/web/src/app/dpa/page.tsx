import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description: "Outrival's DPA for business customers.",
  alternates: { canonical: "/dpa" },
};

export default function DpaPage() {
  return (
    <DocPage
      title="Data Processing Agreement"
      updated="June 2026"
      intro="A signable DPA is available for Business-plan customers and any customer who processes personal data through Outrival."
    >
      <h2>Scope</h2>
      <p>
        The DPA covers Outrival&apos;s processing of personal data on your behalf
        as a processor under the GDPR, including sub-processors, data location
        (EU), and security measures.
      </p>
      <h2>Request a copy</h2>
      <p>
        Email <a href="mailto:hello@outrival.io">hello@outrival.io</a> with your
        company name and we&apos;ll send the current DPA for signature.
      </p>
    </DocPage>
  );
}
