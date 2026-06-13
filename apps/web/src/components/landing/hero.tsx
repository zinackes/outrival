import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const SIGNALS = [
  {
    cat: "Pricing",
    catColor: "text-cat-pricing",
    company: "Linear",
    lead: "cuts the Business plan to",
    metric: "$14/seat",
    tail: ", down from $16.",
    time: "2h",
  },
  {
    cat: "Hiring",
    catColor: "text-cat-hiring",
    company: "Notion",
    lead: "opens 3 “AI Research” roles — its first team in the EU.",
    metric: null,
    tail: "",
    time: "6h",
  },
  {
    cat: "Reviews",
    catColor: "text-cat-reviews",
    company: "Asana",
    lead: "slips to",
    metric: "4.2 on G2",
    tail: " as sentiment turns.",
    time: "1d",
  },
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Atmosphere: cyan kept high and behind the product, so the headline
          stays crisp on near-black. Static; no gradient text. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-x-0 top-0 h-[58rem]"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--border-strong) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            opacity: 0.35,
            maskImage:
              "radial-gradient(58% 46% at 50% 16%, #000 0%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(58% 46% at 50% 16%, #000 0%, transparent 80%)",
          }}
        />
        <div
          className="absolute left-1/2 top-[-24rem] h-[44rem] w-[76rem] max-w-[130vw] -translate-x-1/2 rounded-full opacity-60 blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute left-1/2 top-[40rem] h-[32rem] w-[62rem] max-w-[115vw] -translate-x-1/2 rounded-full opacity-50 blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 65%)",
          }}
        />
      </div>

      {/* The promise */}
      <div className="mx-auto max-w-5xl px-6 pt-36 text-center sm:pt-44">
        <p className="inline-flex items-center gap-2 font-mono text-xs text-text-muted">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full rounded-full bg-positive opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
          </span>
          Monitoring 12 SaaS brands live right now
        </p>

        <h1 className="mx-auto mt-6 max-w-4xl text-[clamp(2.75rem,6vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-balance">
          Your competitors moved this week.{" "}
          <span className="text-primary">You&apos;ll know Monday.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-text-muted text-balance">
          Outrival watches 10 sources per competitor and filters out 99% of the
          noise, so Claude only writes about what actually moves your market. One
          email a week. Critical changes hit Slack in minutes.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Button asChild size="lg">
            <a href="#cta">
              Start monitoring free <ArrowRight size={15} />
            </a>
          </Button>
          <a
            href="#digest"
            className="text-sm text-text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            See a real digest
          </a>
        </div>

        <p className="mt-6 font-mono text-xs text-text-subtle">
          No card · 2 competitors free · Cancel anytime · Hosted in the EU
        </p>
      </div>

      {/* The proof: a live briefing, wide, dissolving into the scroll */}
      <div className="mx-auto mt-20 max-w-4xl px-6">
        <div
          className="rounded-t-xl border border-b-0 border-border bg-surface px-6 pt-6 pb-20 sm:px-10 sm:pt-8"
          style={{
            maskImage: "linear-gradient(to bottom, #000 58%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, #000 58%, transparent 100%)",
          }}
        >
          <div className="flex items-center justify-between border-b border-border pb-4">
            <span className="text-sm font-semibold tracking-tight">
              Out<span className="text-primary">rival</span>
              <span className="ml-2 font-mono text-meta font-normal text-text-subtle">
                weekly digest
              </span>
            </span>
            <span className="font-mono text-meta uppercase tracking-wider text-text-subtle">
              Mon 09:00 · Week 21
            </span>
          </div>

          <ul>
            {SIGNALS.map((s) => (
              <li
                key={s.company}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
              >
                <span
                  className={`w-20 shrink-0 text-sm font-medium ${s.catColor}`}
                >
                  {s.cat}
                </span>
                <p className="min-w-0 flex-1 text-base leading-relaxed">
                  <span className="font-semibold">{s.company}</span>{" "}
                  <span className="text-text-muted">{s.lead}</span>
                  {s.metric && (
                    <span className="font-mono text-[0.9em] text-foreground">
                      {" "}
                      {s.metric}
                    </span>
                  )}
                  <span className="text-text-muted">{s.tail}</span>
                </p>
                <time className="shrink-0 font-mono text-xs text-text-subtle">
                  {s.time}
                </time>
              </li>
            ))}
          </ul>

          <p className="mt-4 font-mono text-xs text-text-subtle">
            847 changes scanned · 3 surfaced · 99% filtered · +9 more in the full
            digest
          </p>
        </div>
      </div>
    </section>
  );
}
