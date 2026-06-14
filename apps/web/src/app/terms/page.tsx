import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Outrival.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <DocPage
      title="Terms of Service"
      updated="June 2026"
      intro="The full terms are being finalized with our counsel. The summary below reflects how the service operates today; the binding document is available on request."
    >
      <h2>The service</h2>
      <p>
        Outrival monitors public competitor sources you configure and delivers
        AI-generated digests and alerts. You are responsible for the competitors
        and sources you add and for using the output lawfully.
      </p>
      <h2>Plans and billing</h2>
      <p>
        Paid plans renew automatically until cancelled. You can change or cancel
        a plan at any time from the billing settings; access continues until the
        end of the paid period.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use Outrival to break the law, infringe third-party rights, or
        circumvent the access controls of the sources being monitored.
      </p>
      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href="mailto:hello@outrival.app">hello@outrival.app</a>.
      </p>
    </DocPage>
  );
}
