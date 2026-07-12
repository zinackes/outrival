import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareFaq } from "./compare-faq";
import { ProductProof } from "./product-proof";
import { ItemListJsonLd } from "./structured-data";
import { BEST_TOOLS, LAST_REVIEWED, PRICE_AS_OF } from "./data";

// Category hub: "Best competitive intelligence tools (2026)". A neutral survey,
// not a ranking with Outrival forced to #1 — the cards carry no ranking numerals,
// only an honest "best for". A direct-answer block opens the list (the paragraph
// an LLM can lift verbatim). Reuses CompareShell / CompareFaq / ProductProof /
// ItemList JSON-LD from the /vs + /alternatives system.

const GLANCE_ROW = "grid grid-cols-[1.4fr_1.2fr_1fr_0.9fr]";

export function BestToolsPage() {
  return (
    <CompareShell>
      <ItemListJsonLd
        name={`Best competitive intelligence tools (${PRICE_AS_OF})`}
        items={BEST_TOOLS.items.map((it) => it.name)}
      />

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
              {
                name: "Best competitive intelligence tools",
                path: "/alternatives/best-competitive-intelligence-tools",
              },
            ]}
          />
          <h1 className="mt-8 max-w-3xl text-[clamp(2.4rem,5vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            Best competitive intelligence tools in 2026
          </h1>
          <p className="mt-4 text-dense text-text-subtle">
            Last reviewed {LAST_REVIEWED} · compared on publicly available
            information
          </p>
          <p className="mt-7 max-w-2xl text-lead leading-relaxed text-text-muted text-pretty">
            {BEST_TOOLS.intro}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/auth">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/#pricing">See pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* At a glance */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          At a glance
        </h2>
        <div className="mt-8 overflow-x-auto">
          <div className="min-w-[640px] border-t border-border-strong">
            <div
              className={`${GLANCE_ROW} border-b border-border text-xs font-medium text-text-subtle`}
            >
              <div className="px-4 py-3">Tool</div>
              <div className="px-4 py-3">Best for</div>
              <div className="px-4 py-3">Entry price</div>
              <div className="px-4 py-3">Self-serve</div>
            </div>
            {BEST_TOOLS.items.map((it) => (
              <div
                key={it.name}
                className={`${GLANCE_ROW} border-b border-border text-sm last:border-b-0 ${
                  it.self ? "bg-primary/[0.04]" : ""
                }`}
              >
                <div
                  className={`px-4 py-3.5 font-medium ${
                    it.self ? "text-primary" : "text-foreground"
                  }`}
                >
                  {it.name}
                </div>
                <div className="px-4 py-3.5 text-text-muted">{it.bestFor}</div>
                <div className="px-4 py-3.5 tabular-nums text-text-muted">
                  {it.entryPrice}
                </div>
                <div
                  className={`px-4 py-3.5 ${
                    it.selfServe.startsWith("Yes")
                      ? "text-positive"
                      : "text-text-subtle"
                  }`}
                >
                  {it.selfServe}
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-dense text-text-subtle">
          Prices for the sales-led tools are third-party estimates; those vendors
          do not publish public pricing. Self-serve prices are the vendors' own
          list. As of {PRICE_AS_OF}.
        </p>
      </section>

      {/* Direct answer + the honest list */}
      <section className="border-y border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-4xl px-6">
          <div className="rounded-xl border border-border bg-surface p-6 sm:p-7">
            <div className="text-dense font-medium text-primary">
              The short answer
            </div>
            <p className="mt-2 leading-relaxed text-text-muted text-pretty">
              {BEST_TOOLS.directAnswer}
            </p>
          </div>
          <p className="mt-8 text-dense text-text-subtle">
            This isn't a strict 1-to-6 ranking — the right tool depends on who you
            are. Here's each, honestly.
          </p>
          <ol className="mt-4 flex flex-col gap-4">
            {BEST_TOOLS.items.map((it) => (
              <li
                key={it.name}
                className={`rounded-xl border p-6 sm:p-8 ${
                  it.self
                    ? "border-primary/40 bg-primary/[0.03]"
                    : "border-border bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-xl font-semibold">{it.name}</h3>
                  {it.self && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-meta font-medium text-primary">
                      Our pick for founders &amp; small teams
                    </span>
                  )}
                  <span className="ml-auto text-dense text-text-subtle">
                    {it.bestFor}
                  </span>
                </div>
                <p className="mt-4 leading-relaxed text-text-muted text-pretty">
                  {it.body}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-text-subtle">
                  <span className="font-medium text-text-muted">
                    The tradeoff:
                  </span>{" "}
                  {it.tradeoff}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <span className="tabular-nums text-text-subtle">
                    {it.entryPrice}
                  </span>
                  {it.self ? (
                    <Link
                      href="/auth"
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      Start free
                      <ArrowRight size={13} aria-hidden />
                    </Link>
                  ) : it.href ? (
                    <Link
                      href={it.href}
                      className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
                    >
                      Outrival vs {it.name}
                      <ArrowRight size={13} aria-hidden />
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Product proof */}
      <ProductProof />

      {/* FAQ */}
      <CompareFaq
        heading="Choosing a CI tool, answered"
        faqs={BEST_TOOLS.faqs}
      />

      {/* CTA + cross-links + sources */}
      <section className="border-t border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10">
            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              The self-serve pick, free to try.
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-text-muted">
              If you're a founder or small team, skip the demos. Add two
              competitors on the free plan and read your first AI-written brief
              this week.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/#pricing">See all plans</Link>
              </Button>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href="/vs/crayon"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs Crayon
              <ArrowRight size={13} aria-hidden />
            </Link>
            <Link
              href="/vs/klue"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs Klue
              <ArrowRight size={13} aria-hidden />
            </Link>
            <Link
              href="/vs/diy"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs doing it yourself
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>

          <div className="mt-10 border-t border-border pt-6 text-dense leading-relaxed text-text-subtle">
            <p>
              Comparison based on publicly available information as of{" "}
              {PRICE_AS_OF}. The sales-led tools do not publish public pricing;
              their figures are dated third-party estimates and vary by seats,
              competitors tracked and contract terms. Self-serve prices are the
              vendors' own published list. Outrival is independent and not
              affiliated with the vendors named; all trademarks belong to their
              respective owners.
            </p>
            <p className="mt-2">
              Sources:{" "}
              {BEST_TOOLS.sources.map((s, i) => (
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
            <p className="mt-2">
              Outrival offers EU data storage — see our{" "}
              <Link
                href="/security"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                security overview
              </Link>{" "}
              for specifics.
            </p>
          </div>
        </div>
      </section>
    </CompareShell>
  );
}
