import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DigestMockup } from "./digest-mockup";

export function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div>
          <div className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Live · 12 SaaS brands tracked right now
          </div>
          <h1>
            Your competitors moved this week.
            <br />
            <em>You&apos;ll know Monday morning.</em>
          </h1>
          <p className="hero-sub">
            Outrival watches 10 sources per competitor — pricing pages,
            changelogs, job boards, G2 reviews. A classifier filters out 99% of
            the noise, so Claude only writes about what actually moves your
            market. One email a week. Critical changes hit Slack in under five
            minutes.
          </p>
          <div className="hero-ctas">
            <Button asChild>
              <a href="#cta">
                Start monitoring free <ArrowRight size={14} />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="#digest">See a real digest</a>
            </Button>
          </div>
          <div className="hero-fineprint">
            <span className="dot">●</span> No credit card
            <span className="sep">·</span> 2 competitors free
            <span className="sep">·</span> Cancel in one click
            <span className="sep">·</span> Hosted in EU
          </div>
          <div className="hero-stack">
            <span className="hero-stack-label">Pipeline</span>
            <span className="hero-stack-chip">Crawlee</span>
            <span className="hero-stack-arrow">→</span>
            <span className="hero-stack-chip">Groq · Llama 70B</span>
            <span className="hero-stack-arrow">→</span>
            <span className="hero-stack-chip">Claude Sonnet 4.6</span>
            <span className="hero-stack-arrow">→</span>
            <span className="hero-stack-chip">Slack · Email</span>
          </div>
        </div>
        <div>
          <DigestMockup animate={true} />
        </div>
      </div>
    </section>
  );
}
