import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// End-of-article call to action. Mirrors the landing CTA band (rounded-2xl,
// surface→background-2 gradient) but scoped to the reading column and pointed at
// the sample-digest lead form rather than signup. ?intent=sample matters: the
// generic /demo never repeated this offer, so the click used to land somewhere
// that asked for a team size instead of the two competitors just promised.
export function PostCta() {
  return (
    <aside className="mt-14 rounded-2xl border border-border bg-gradient-to-b from-surface to-background-2 p-8">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        Get a sample digest for your market
      </h2>
      <p className="mt-3 leading-relaxed text-text-muted">
        Tell us your product and two competitors. We&apos;ll scrape them and send
        you a real Outrival brief — the same one you&apos;d get every Monday — so
        you can see the signal before you sign up for anything.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link href="/demo?intent=sample">
            Get a sample digest <ArrowRight size={14} />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/auth">Start free</Link>
        </Button>
      </div>
    </aside>
  );
}
