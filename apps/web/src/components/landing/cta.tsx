import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="cta-block" id="cta">
      <div className="wrap">
        <div className="cta-inner">
          <div>
            <h2>
              First signal in
              <br />
              under 10 minutes.
            </h2>
            <p className="lede">
              Add 2 competitors. We scrape them immediately. You get a digest
              sample the same day — no credit card, no sales call, cancel in one
              click.
            </p>
          </div>
          <div className="cta-actions">
            <Button asChild size="lg">
              <Link href="/register">
                Start monitoring free <ArrowRight size={14} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href="mailto:hello@outrival.io">Request a demo</a>
            </Button>
            <div className="cta-fineprint">
              Your data stays in the EU · DPA available on request
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
