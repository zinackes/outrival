import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="py-20 sm:py-28" id="cta">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-8 rounded-2xl border border-border bg-gradient-to-b from-surface to-background-2 p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              First signal in
              <br />
              under 10 minutes.
            </h2>
            <p className="mt-4 text-text-muted leading-relaxed">
              Add 2 competitors. We scrape them immediately. You get a digest
              sample the same day — no credit card, no sales call, cancel in one
              click.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <Button asChild size="lg">
              <Link href="/auth">
                Start monitoring free <ArrowRight size={14} />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href="mailto:hello@outrival.io">Request a demo</a>
            </Button>
            <div className="text-xs text-text-subtle">
              Your data stays in the EU · DPA available on request
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
