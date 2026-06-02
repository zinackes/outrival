import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DigestMockup } from "./digest-mockup";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs text-text-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-positive" />
            Live · 12 SaaS brands tracked right now
          </div>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Your competitors moved this week.
            <br />
            <em className="text-primary not-italic">
              You&apos;ll know Monday morning.
            </em>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-text-muted sm:text-lg">
            Outrival watches 10 sources per competitor — pricing pages,
            changelogs, job boards, G2 reviews. A classifier filters out 99% of
            the noise, so Claude only writes about what actually moves your
            market. One email a week. Critical changes hit Slack in under five
            minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="#cta">
                Start monitoring free <ArrowRight size={14} />
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#digest">See a real digest</a>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-text-subtle">
            <span className="text-positive">●</span> No credit card
            <span>·</span> 2 competitors free
            <span>·</span> Cancel in one click
            <span>·</span> Hosted in EU
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-text-subtle">
              Pipeline
            </span>
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-text-muted">
              Crawlee
            </span>
            <span className="text-text-subtle">→</span>
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-text-muted">
              Groq · Llama 70B
            </span>
            <span className="text-text-subtle">→</span>
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-text-muted">
              Claude Sonnet 4.6
            </span>
            <span className="text-text-subtle">→</span>
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-text-muted">
              Slack · Email
            </span>
          </div>
        </div>
        <div>
          <DigestMockup animate={true} />
        </div>
      </div>
    </section>
  );
}
