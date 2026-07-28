import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon } from "@/components/icons";
import { Footer } from "@/components/landing/footer";
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
    <div className="landing-canvas min-h-dvh bg-background font-sans text-foreground antialiased">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Out<span className="text-primary">rival</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon size={16} /> Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-16">
        {/* Real product, above the form — see it before you book. Spans both
            grid columns so it sits above the form on desktop and mobile alike. */}
        <section className="lg:col-span-2">
          <span className="text-meta font-medium uppercase tracking-wider text-primary">
            A look at the product
          </span>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 sm:items-start">
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
        </section>
        <div>
          <span className="text-meta font-medium uppercase tracking-wider text-primary">
            {isBusiness
              ? "Business plan"
              : isSample
                ? "Sample digest"
                : "See the product"}
          </span>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {isBusiness ? (
              <>
                See Outrival
                <br />
                for Business.
              </>
            ) : isSample ? (
              <>
                A sample digest
                <br />
                for your market.
              </>
            ) : (
              <>
                See Outrival on
                <br />
                your competitors.
              </>
            )}
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-text-muted">
            {isBusiness
              ? "Business is self-serve: you can start it right from sign-up. Need SSO, a custom DPA, or a hand importing users? Tell us here and we'll get you set up."
              : isSample
                ? "Tell us your product and two competitors. We'll scrape them and send you a real Outrival brief (the same one you'd get every Monday) so you can see the signal before you sign up for anything."
                : "Want a closer look before you start? Tell us your market and we'll show you what Outrival surfaces for it. You can also start free right now, no call needed."}
          </p>
          {isSample && (
            // Capacity guard: these are produced by hand today. Saying so in the
            // offer is cheaper than owing briefs we cannot deliver.
            <p className="mt-3 max-w-md text-sm text-text-subtle">
              We put these together by hand, so we take on a few each week.
              You&apos;ll hear back either way.
            </p>
          )}
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-text-muted">
                <CheckIcon size={16} className="mt-0.5 shrink-0 text-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-text-muted">
            Just want to see the output?{" "}
            <a
              href="/sample"
              className="text-primary underline-offset-2 hover:underline"
            >
              See a sample digest
            </a>{" "}
            (a real one, no form needed).
          </p>
          <p className="mt-4 text-xs text-text-subtle">
            Prefer email? Write to{" "}
            <a
              href="mailto:hello@outrival.app"
              className="text-primary underline-offset-2 hover:underline"
            >
              hello@outrival.app
            </a>
            .
          </p>
        </div>

        <DemoForm
          defaultPlan={isBusiness ? "business" : isSample ? "sample-digest" : undefined}
          intent={isSample ? "sample" : undefined}
        />
      </main>

      <Footer />
    </div>
  );
}
