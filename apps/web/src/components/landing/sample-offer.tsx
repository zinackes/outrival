import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// The lowest-commitment step in the funnel, and until now it only existed at the
// foot of blog posts: we build a real brief on the visitor's own market, by
// hand, with no account. It sits immediately above the pricing table so the
// reader who isn't ready to pick a plan has somewhere to go that isn't "leave".
//
// The "a few each week" line is load-bearing, not modesty: these are produced by
// hand, and an offer without a stated limit becomes a debt the week it works.
export function SampleOffer() {
  return (
    <section className="py-16 sm:py-20" id="sample-offer" data-reveal>
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Not sure yet? Get a digest for your market.
            </h2>
            <p className="mt-3 leading-relaxed text-text-muted">
              Tell us your product and two competitors. We&apos;ll scrape them
              and send you a real brief (the same one you&apos;d get every
              Monday) so you can judge the signal before signing up for
              anything.
            </p>
            <p className="mt-2 text-sm text-text-subtle">
              Written by hand, so we take a few each week. No account, no card.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
            <Button asChild size="lg">
              <Link href="/demo?intent=sample">
                Get a sample digest <ArrowRight size={14} />
              </Link>
            </Button>
            <Link
              href="/sample"
              className="text-sm text-text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Or read one we already published
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
