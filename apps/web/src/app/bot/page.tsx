import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { DocPage } from "@/components/landing/doc-page";
import { CONTACT, LEGAL_VERSION } from "@/lib/legal/entity";

export const metadata: Metadata = pageMetadata({
  path: "/bot",
  title: "OutrivalBot, our crawler",
  description:
    "What OutrivalBot is, what it collects, how often, and exactly how to block it. Outrival collects only what is openly published and never bypasses a site's controls.",
});

export default function BotPage() {
  return (
    <DocPage
      title="OutrivalBot"
      updated={LEGAL_VERSION.updatedEn}
      intro="Outrival monitors competitor websites on behalf of our customers. Our crawler, OutrivalBot, identifies itself on every request and collects only what a site publishes openly. This page explains what it does and how to block it."
    >
      <div className="lp-doc-body">
        <h2>Who we are</h2>
        <p>
          OutrivalBot is the automated crawler operated by Outrival, a
          competitive-intelligence service. It visits public web pages our
          customers ask us to monitor (a competitor's homepage, pricing,
          changelog, careers page, and similar) to detect changes over time.
        </p>
        <p>
          Every request we send carries this identifiable User-Agent, which links
          back to this page:
        </p>
        <pre>
          <code>Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.app/bot)</code>
        </pre>
        <p>
          We do not disguise the crawler as a human browser, and we do not rotate
          identities to hide who is visiting.
        </p>

        <h2>What we collect</h2>
        <p>
          Only content that is <strong>openly published</strong> on the page:
          visible text and its structure, publicly served images and scripts, and
          standard HTTP response headers. We use this to detect and summarize
          changes for the customer monitoring that site.
        </p>
        <ul>
          <li>
            We <strong>respect <code>robots.txt</code></strong>. If your
            robots.txt disallows OutrivalBot (or all bots) for a path, we do not
            request that path.
          </li>
          <li>
            We <strong>do not bypass logins, paywalls, or access controls</strong>.
            If a page requires authentication or serves an anti-bot challenge, we
            treat that as a refusal and stop. We do not attempt to work around it.
          </li>
          <li>
            We <strong>rate-limit</strong> ourselves per domain and honour any{" "}
            <code>Crawl-delay</code> your robots.txt specifies.
          </li>
          <li>
            We do not collect personal data beyond what a site publishes on the
            pages we are asked to monitor.
          </li>
        </ul>

        <h2>How often we visit</h2>
        <p>
          Cadence depends on what a customer is monitoring, typically between once
          an hour and once a week per page, and it slows automatically for pages
          that rarely change. A single page is never fetched more than once every
          couple of seconds.
        </p>

        <h2>How to block us</h2>
        <p>
          Add the following to your site's <code>robots.txt</code> to stop
          OutrivalBot entirely:
        </p>
        <pre>
          <code>{`User-agent: OutrivalBot\nDisallow: /`}</code>
        </pre>
        <p>
          To block only part of your site, disallow specific paths under the same{" "}
          <code>User-agent: OutrivalBot</code> group. We refresh robots.txt at
          least daily, so a change takes effect within 24 hours.
        </p>

        <h2>Contact &amp; takedown</h2>
        <p>
          If you want us to stop monitoring a page, have a question, or need to
          report a problem with the crawler, email{" "}
          <a href={`mailto:${CONTACT.general}`}>{CONTACT.general}</a>. We act on
          takedown requests promptly.
        </p>
      </div>
    </DocPage>
  );
}
