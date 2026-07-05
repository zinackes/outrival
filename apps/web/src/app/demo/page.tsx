import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import Image from "next/image";
import { Footer } from "@/components/landing/footer";
import { DemoForm } from "./demo-form";

export const metadata: Metadata = {
  title: "Request a demo",
  description:
    "Talk to the Outrival team — book a live demo on your own market, or ask about the Business plan.",
  alternates: { canonical: "/demo" },
};

const DEMO_POINTS = [
  "A live walkthrough on your actual competitors",
  "How the weekly digest and real-time alerts read for your market",
  "Answers on plans, onboarding, and EU hosting",
];

const BUSINESS_POINTS = [
  "50 competitors and every review source",
  "Priority monitoring cadence",
  "DPA, security review, and procurement support",
];

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const isBusiness = plan === "business";
  const points = isBusiness ? BUSINESS_POINTS : DEMO_POINTS;

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
            <ArrowLeft size={14} /> Back to home
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
            <figure className="space-y-2.5">
              <Image
                src="/product/overview.webp"
                alt="Outrival dashboard overview: KPI tiles for signals, critical pending and active competitors, above a feed of recent competitor signals across pricing, product, hiring and funding."
                width={2240}
                height={1626}
                sizes="(min-width: 640px) 400px, 100vw"
                className="h-auto w-full rounded-xl border border-border bg-surface shadow-lg shadow-black/20"
              />
              <figcaption className="text-dense text-text-subtle">
                Your overview — every competitor, ranked by what moved.
              </figcaption>
            </figure>
            <figure className="space-y-2.5">
              <Image
                src="/product/signal-detail.webp"
                alt="A single Outrival signal in detail: a critical pricing alert that a competitor cut its Pro plan 30%, with the strategic insight, recommended action, and a before-and-after of the pricing change."
                width={1720}
                height={886}
                sizes="(min-width: 640px) 400px, 100vw"
                className="h-auto w-full rounded-xl border border-border bg-surface shadow-lg shadow-black/20"
              />
              <figcaption className="text-dense text-text-subtle">
                One signal, in full — what changed, why, and what to do.
              </figcaption>
            </figure>
          </div>
        </section>
        <div>
          <span className="text-meta font-medium uppercase tracking-wider text-primary">
            {isBusiness ? "Business plan" : "Request a demo"}
          </span>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {isBusiness ? (
              <>
                Let&apos;s talk
                <br />
                about Business.
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
              ? "Business is sales-assisted so we can set up your workspace, users, and DPA. Tell us a little and we'll be in touch within one business day."
              : "Tell us what you'd like to see. We'll get back within one business day — usually with a demo booked on your own market."}
          </p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-text-muted">
                <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-text-subtle">
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

        <DemoForm defaultPlan={isBusiness ? "business" : undefined} />
      </main>

      <Footer />
    </div>
  );
}
