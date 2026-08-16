import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { CheckIcon } from "@/components/icons";
import { Footer } from "@/components/landing/footer";
import { Band, PageHero } from "@/components/landing/compare/compare-shell";
import { ProductShot } from "@/components/landing/product-shot";
import { DemoForm } from "./demo-form";

export const metadata: Metadata = pageMetadata({
  path: "/demo",
  title: "See Outrival",
  description:
    "See Outrival on your own competitors: a live look at the product and a sample of the weekly digest.",
});

const DEMO_POINTS = [
  "How Outrival reads your actual competitors",
  "What the weekly digest and real-time alerts look like for your market",
  "Answers on plans, onboarding, and EU hosting",
];

const BUSINESS_POINTS = [
  "50 competitors and the highest usage limits",
  "Priority monitoring cadence",
  "DPA, security review, and procurement support",
];

// ?intent=sample — the offer the blog posts close with. It promises a specific
// deliverable, so the page has to repeat it exactly: the visitor who clicked
// "Get a sample digest" must land on a form that says the same thing back.
const SAMPLE_POINTS = [
  "A real brief on your market, not a generic example",
  "Built from your product and two competitors you name",
  "Delivered by email; no account, no card, no call",
];

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; intent?: string }>;
}) {
  const { plan, intent } = await searchParams;
  const isBusiness = plan === "business";
  const isSample = intent === "sample" && !isBusiness;
  const points = isBusiness
    ? BUSINESS_POINTS
    : isSample
      ? SAMPLE_POINTS
      : DEMO_POINTS;

  return (
    <div className="landing-canvas lp-light lp-page min-h-dvh font-sans antialiased">
      <main id="main-content" tabIndex={-1}>
        <PageHero>
          <p className="lp-page-meta">
            {isBusiness
              ? "Business plan"
              : isSample
                ? "Sample digest"
                : "See the product"}
          </p>
          <h1>
            {isBusiness ? (
              <>
                See Outrival for{" "}
                <span className="lp-serif-accent">Business</span>
              </>
            ) : isSample ? (
              <>
                A sample digest for your{" "}
                <span className="lp-serif-accent">market</span>
              </>
            ) : (
              <>
                See Outrival on your{" "}
                <span className="lp-serif-accent">competitors</span>
              </>
            )}
          </h1>
          <p className="lp-page-lead">
            {isBusiness
              ? "Business is self-serve: you can start it right from sign-up. Need SSO, a custom DPA, or a hand importing users? Tell us here and we'll get you set up."
              : isSample
                ? "Tell us your product and two competitors. We'll scrape them and send you a real Outrival brief (the same one you'd get every Monday) so you can see the signal before you sign up for anything."
                : "Want a closer look before you start? Tell us your market and we'll show you what Outrival surfaces for it. You can also start free right now, no call needed."}
          </p>
          {isSample && (
            // Capacity guard: these are produced by hand today. Saying so in the
            // offer is cheaper than owing briefs we cannot deliver.
            <p className="lp-form-note">
              We put these together by hand, so we take on a few each week.
              You&apos;ll hear back either way.
            </p>
          )}
        </PageHero>

        {/* The product before the form: a visitor asked to fill in five fields
            deserves to have seen the thing first. Graphite, because the shots
            are dark-chrome screenshots and the band flips the token set for
            them. */}
        <Band tone="dark">
          <div className="lp-head">
            <h2>
              The product, before you{" "}
              <span className="lp-serif-accent">ask</span>.
            </h2>
            <p>
              Two screens from a live workspace: the overview you land on every
              Monday, and one signal opened in full.
            </p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 sm:items-start">
            <ProductShot
              src="/product/overview.webp"
              alt="Outrival dashboard overview: KPI tiles for signals, critical pending and active competitors, above a feed of recent competitor signals across pricing, product, hiring and funding."
              width={2240}
              height={1626}
              sizes="(min-width: 640px) 400px, 100vw"
              caption="Your overview: every competitor, ranked by what moved."
            />
            <ProductShot
              src="/product/signal-detail.webp"
              alt="A single Outrival signal in detail: a critical pricing alert that a competitor cut its Pro plan 30%, with the strategic insight, recommended action, and a before-and-after of the pricing change."
              width={1720}
              height={886}
              sizes="(min-width: 640px) 400px, 100vw"
              caption="One signal, in full: what changed, why, and what to do."
            />
          </div>
        </Band>

        <Band tone="paper">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
            <div>
              <ul className="lp-checks">
                {points.map((p) => (
                  <li key={p}>
                    <CheckIcon size={16} aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <p className="lp-form-note">
                Just want to see the output?{" "}
                <a href="/sample">See a sample digest</a> (a real one, no form
                needed).
              </p>
              <p className="lp-form-note">
                Prefer email? Write to{" "}
                <a href="mailto:hello@outrival.app">hello@outrival.app</a>.
              </p>
            </div>

            <DemoForm
              defaultPlan={
                isBusiness ? "business" : isSample ? "sample-digest" : undefined
              }
              intent={isSample ? "sample" : undefined}
            />
          </div>
        </Band>
      </main>

      <div className="dark" data-lp-tone="dark">
        <Footer />
      </div>
    </div>
  );
}
