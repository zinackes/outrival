import Link from "next/link";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareTable } from "./compare-table";
import { PricingFaceOff } from "./pricing-face-off";
import { CompareFaq } from "./compare-faq";
import { ProductProof } from "./product-proof";
import {
  COMPETITORS,
  LAST_REVIEWED,
  OUTRIVAL_WINS,
  PRICE_AS_OF,
  type CompetitorKey,
} from "./data";

function SectionHead({
  kicker,
  title,
  lead,
}: {
  kicker?: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-2xl">
      {kicker && (
        <div className="text-dense font-medium text-primary">{kicker}</div>
      )}
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 leading-relaxed text-text-muted text-pretty">
          {lead}
        </p>
      )}
    </div>
  );
}

export function VsPage({ competitorKey }: { competitorKey: CompetitorKey }) {
  const c = COMPETITORS[competitorKey];
  const other: CompetitorKey = competitorKey === "crayon" ? "klue" : "crayon";
  const otherName = COMPETITORS[other].name;

  return (
    <CompareShell>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute left-1/2 top-0 h-[26rem] w-[52rem] max-w-[120vw] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)",
            }}
          />
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-12 pt-10 sm:pt-12">
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              { name: `Outrival vs ${c.name}`, path: `/vs/${c.key}` },
            ]}
          />
          <h1 className="mt-8 max-w-3xl text-[clamp(2.4rem,5vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            Outrival vs {c.name}
          </h1>
          <p className="mt-4 text-dense text-text-subtle">
            Last reviewed {LAST_REVIEWED} · compared on publicly available
            information
          </p>
          <div className="mt-7 max-w-2xl space-y-3.5 text-lead leading-relaxed text-text-muted text-pretty">
            {c.verdict.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/auth">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={`/alternatives/${c.key}`}>
                See all {c.name} alternatives
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Feature comparison */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionHead
          title="Feature by feature"
          lead={`How the two line up on the things a buyer decides on. ${c.name} is the better tool for a staffed intelligence program; the table shows where Outrival is the better fit for a small team.`}
        />
        <div className="mt-10">
          <CompareTable competitorKey={c.key} />
        </div>
      </section>

      {/* Product proof — the real dashboard, so this isn't just claims */}
      <div className="border-t border-border bg-background-2">
        <ProductProof />
      </div>

      {/* Pricing */}
      <section className="border-y border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <SectionHead
            title="Pricing, side by side"
            lead={`${c.name} is quote-based and sales-led, so its numbers are dated third-party estimates. Outrival's are its published list price.`}
          />
          <div className="mt-10">
            <PricingFaceOff competitorKey={c.key} />
          </div>
        </div>
      </section>

      {/* Honest two-up */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionHead
          title="Which one is right for you"
          lead="No tool wins every profile. Here is the honest split, so you pick the one that fits how you work."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {/* When competitor is better */}
          <div className="rounded-xl border border-border bg-surface p-6 sm:p-7">
            <h3 className="text-lg font-semibold">
              When {c.name} is the better choice
            </h3>
            <ul className="mt-5 flex flex-col gap-4">
              {c.betterWhen.map((b) => (
                <li key={b.title} className="flex gap-3">
                  <MinusIcon
                    size={16}
                    className="mt-1 shrink-0 text-text-subtle"
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {b.title}.
                    </span>{" "}
                    <span className="text-sm leading-relaxed text-text-muted">
                      {b.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* When Outrival wins */}
          <div className="rounded-xl border border-primary/40 bg-primary/[0.03] p-6 sm:p-7">
            <h3 className="text-lg font-semibold">When Outrival wins</h3>
            <ul className="mt-5 flex flex-col gap-4">
              {OUTRIVAL_WINS.map((b) => (
                <li key={b.title} className="flex gap-3">
                  <CheckIcon
                    size={16}
                    className="mt-1 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {b.title}.
                    </span>{" "}
                    <span className="text-sm leading-relaxed text-text-muted">
                      {b.body}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <CompareFaq
        heading={`Outrival vs ${c.name}, answered`}
        faqs={c.faqs}
      />

      {/* Cross-links + CTA */}
      <section className="border-t border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10">
            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              Get your first competitor brief in three minutes.
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-text-muted">
              No demo, no annual contract. Add two competitors on the free plan
              and see the Monday brief for yourself.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">See all plans</Link>
              </Button>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href={`/vs/${other}`}
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs {otherName}
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
            <Link
              href={`/alternatives/${c.key}`}
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Best {c.name} alternatives
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
            <Link
              href={`/alternatives/${other}`}
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Best {otherName} alternatives
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
            <Link
              href="/vs/diy"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs doing it yourself
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
            <Link
              href="/alternatives/best-competitive-intelligence-tools"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Best competitive-intelligence tools
              <ArrowRightIcon size={16} aria-hidden />
            </Link>
          </div>

          {/* Sources + legal disclaimer */}
          <div className="mt-10 border-t border-border pt-6 text-dense leading-relaxed text-text-subtle">
            <p>
              Comparison based on publicly available information as of{" "}
              {PRICE_AS_OF}. {c.name} does not publish public pricing; figures
              are third-party estimates and vary by seats, competitors tracked
              and contract terms. Outrival is independent and not affiliated
              with {c.name}; all trademarks belong to their respective owners.
            </p>
            <p className="mt-2">
              Outrival offers EU data storage, see our{" "}
              <Link
                href="/security"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                security overview
              </Link>{" "}
              for specifics.
            </p>
            <p className="mt-2">
              Sources:{" "}
              {c.sources.map((s, i) => (
                <span key={s.href}>
                  {i > 0 && " · "}
                  <a
                    href={s.href}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {s.label}
                  </a>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      </section>
    </CompareShell>
  );
}
