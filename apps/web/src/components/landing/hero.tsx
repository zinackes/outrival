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
      {/* Atmosphere: a single restrained glow biased toward the product card,
          so the headline stays crisp on near-black. Static; no gradient text,
          no dot grid. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute right-[-10%] top-[-12rem] h-[44rem] w-[60rem] max-w-[110vw] rounded-full opacity-55 blur-[140px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 62%)",
          }}
        />
        <div
          className="absolute left-[-6rem] top-[18rem] h-[30rem] w-[40rem] max-w-[90vw] rounded-full opacity-40 blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-x-12 gap-y-14 px-6 pb-24 pt-32 sm:pt-40 lg:grid-cols-12 lg:pb-28">
        {/* The promise */}
        <div className="lg:col-span-6 xl:col-span-5">
          <p className="inline-flex items-center gap-2 font-mono text-xs text-text-muted">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full rounded-full bg-positive opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
            </span>
            Always-on competitive monitoring
          </p>

          <h1 className="mt-5 text-[clamp(2.5rem,4.8vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance">
            <span className="text-text-muted">
              Your competitors moved this week.
            </span>{" "}
            <span className="block">You&apos;ll know Monday.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-muted text-pretty">
            Outrival watches every public surface a competitor has and filters
            out 99% of the noise, so the AI only writes about what actually moves
            your market. One email a week. Critical changes hit Slack in minutes.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button asChild size="lg">
              <a href="#cta">
                Start monitoring free <ArrowRight size={15} />
              </a>
            </Button>
            <a
              href="#digest"
              className="text-sm text-text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              See a sample digest
            </a>
          </div>

          <p className="mt-7 font-mono text-xs text-text-subtle">
            No card · 2 competitors free · Cancel anytime · Hosted in the EU
          </p>
        </div>

        {/* The proof: a live briefing rendered as the app surface itself. */}
        <div className="lg:col-span-6 xl:col-span-7">
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-border bg-background-2 px-5 py-3.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full rounded-full bg-positive opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
                </span>
                Out<span className="text-primary">rival</span>
                <span className="ml-1 font-mono text-meta font-normal text-text-subtle">
                  weekly digest
                </span>
              </span>
              <span className="font-mono text-meta uppercase tracking-wider text-text-subtle">
                Mon 09:00 · Week 21
              </span>
            </div>

            <ul className="px-5 sm:px-6">
              {SIGNALS.map((s) => (
                <li
                  key={s.company}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4 last:border-b-0"
                >
                  <span
                    className={`w-16 shrink-0 text-dense font-medium ${s.catColor}`}
                  >
                    {s.cat}
                  </span>
                  <p className="min-w-0 flex-1 text-content leading-relaxed">
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

            <p className="border-t border-border bg-background-2 px-5 py-3 font-mono text-xs text-text-subtle sm:px-6">
              847 changes scanned · 3 surfaced · 99% filtered · +9 in the full
              digest
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
