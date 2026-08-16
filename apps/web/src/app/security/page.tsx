import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { DocPage } from "@/components/landing/doc-page";
import { CONTACT, LEGAL_VERSION } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/security",
  title: "Security & Trust",
  description:
    "How Outrival stores your data in the EU, keeps AI outputs grounded and verifiable, and scrapes responsibly. A factual trust overview.",
});

export default function SecurityPage() {
  return (
    <DocPage
      title={
        <>
          Security &amp; <span className="lp-serif-accent">trust</span>
        </>
      }
      updated={LEGAL_VERSION.updatedEn}
      intro="How we store your data, how we keep AI outputs grounded and verifiable, and how we scrape responsibly. This page describes what Outrival does today, not aspirations."
    >
      <div className="lp-doc-body">
        <h2>Where your data lives</h2>
        <p>
          Outrival is built for <strong>EU data storage</strong>. Your account,
          workspace configuration, signals and digests live in a managed
          PostgreSQL database (Neon) in an EU region. Page snapshots,
          screenshots and generated PDFs live in object storage (Cloudflare R2).
          The application runs on infrastructure in the EU (OVHcloud), and the
          background workers and job queue on EU infrastructure too (netcup, in
          Austria).
        </p>
        <p>
          Data is <strong>encrypted in transit</strong> with TLS. Our database
          and object storage are <strong>encrypted at rest</strong> by the
          storage platform. The full list of providers, with each one&apos;s
          location and transfer safeguards, is on our{" "}
          <a href="/subprocessors">subprocessors page</a>.
        </p>

        <h2>AI processing</h2>
        <p>
          We want to be exact here rather than flattering. Generating insights
          requires AI inference, and today that inference runs through
          third-party model providers, some of them located outside the EU
          (notably in the United States). Those providers act as subprocessors
          under a Data Processing Agreement, and transfers rely on the EU
          Standard Contractual Clauses.
        </p>
        <p>
          That is precisely why we say <strong>&ldquo;EU data storage&rdquo;</strong>{" "}
          and not <strong>&ldquo;EU processing&rdquo;</strong>: where your data
          rests is in the EU, but the model inference step is not EU-only yet. An
          EU-only inference mode is on our roadmap. Every provider we send
          prompts to is listed, with its location, on our{" "}
          <a href="/subprocessors">subprocessors page</a>.
        </p>

        <h2>Subprocessors &amp; DPA</h2>
        <p>
          The authoritative, current list of third-party providers that may
          process data on our behalf (with purpose, location and transfer
          safeguard for each) is our{" "}
          <a href="/subprocessors">subprocessors page</a>. Business customers can
          enter our{" "}
          <a href="/dpa">Data Processing Agreement</a> (GDPR Article 28), which
          references that list and commits us to advance notice of changes.
        </p>

        <h2>Data retention &amp; deletion</h2>
        <p>
          We keep data only as long as we need it, and you can remove it
          yourself at any time:
        </p>
        <ul>
          <li>
            Account and workspace data is kept for the life of your account and
            deleted on erasure. Page snapshots and monitoring history follow your
            plan&apos;s retention window.
          </li>
          <li>
            Invoices are retained for 10 years, as French accounting law
            requires.
          </li>
          <li>
            Security and anti-abuse logs (IP address, request logs) are kept for
            up to 12 months.
          </li>
          <li>
            You can <strong>export</strong> all your workspace data yourself from{" "}
            <a href="/dashboard/settings/data">Settings → Data</a>, and{" "}
            <strong>permanently delete</strong> your account or workspace from{" "}
            <a href="/dashboard/settings/danger">Settings → Danger zone</a>.
          </li>
          <li>
            To exercise any other GDPR right, email{" "}
            <a href={`mailto:${CONTACT.privacy}`}>{CONTACT.privacy}</a>. We
            respond within one month.
          </li>
        </ul>
        <p className="fine">
          The complete policy, legal bases and retention table are in our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>AI reliability</h2>
        <p>
          This is the part we care about most. Competitive intelligence is only
          useful if you can trust it. <strong>An AI that invents competitor
          moves is worse than no AI at all</strong>, because you act on it. So we
          treat hallucination as a security problem, not a cosmetic one, and the
          pipeline is built to catch it. What runs today:
        </p>
        <ul>
          <li>
            <strong>Cite or drop.</strong> For user-facing generations, the model
            must back every factual assertion with a verbatim quote from the
            scraped source. If it cannot quote support, it is instructed to drop
            the claim or lower its confidence.
          </li>
          <li>
            <strong>Quotes are verified against the source.</strong> Each quote
            the model returns is checked against the actual scraped text (exact
            match, then a bounded fuzzy match). Quotes that do not occur in the
            source are recorded as failed grounding.
          </li>
          <li>
            <strong>Invented numbers are caught deterministically.</strong> A
            separate check scans generated prose for significant numbers (prices,
            percentages, counts, ratings) that never appeared in the source, the
            most damaging kind of hallucination.
          </li>
          <li>
            <strong>A second, independent pass audits the risky outputs.</strong>{" "}
            Battle cards (the most visible, highest-stakes output) and any
            low-confidence output are re-checked by a fresh model call whose only
            job is to flag unsupported claims, over-extrapolation, and facts
            mixed in from the wrong company.
          </li>
          <li>
            <strong>Every output carries a confidence level.</strong> Outputs are
            marked low, medium or high confidence, and that marker is shown on the
            signal, so an uncertain call reads as uncertain.
          </li>
          <li>
            <strong>Doubtful outputs are flagged, not passed off as fact.</strong>{" "}
            When the second pass flags an output, it is routed to an internal
            review queue and triaged (confirmed hallucination vs. false positive)
            instead of being presented to you as a confident finding.
          </li>
        </ul>

        <h2>Responsible scraping</h2>
        <p>
          Outrival only monitors <strong>publicly accessible</strong> pages that
          you configure, the same pages a person could open in a browser. In
          practice that means we:
        </p>
        <ul>
          <li>
            collect only publicly available content, without bypassing logins or
            paywalls;
          </li>
          <li>
            respect <code>robots.txt</code> and reasonable rate limits, and crawl
            one page per domain at a time;
          </li>
          <li>
            back off when a site blocks us rather than forcing our way through,
            and stop monitoring a source that stays unreachable;
          </li>
          <li>
            focus on companies and products rather than individuals, and do not build
            profiles of natural persons or scrape special-category data.
          </li>
        </ul>

        <h2>Reporting a security issue</h2>
        <p>
          If you believe you have found a security vulnerability, please email{" "}
          <a href={`mailto:${CONTACT.security}`}>{CONTACT.security}</a>. Include
          enough detail to reproduce the issue, and give us a reasonable window
          to investigate and fix it before any public disclosure. We read every
          report and will acknowledge yours.
        </p>
      </div>
    </DocPage>
  );
}
