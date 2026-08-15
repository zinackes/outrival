import Link from "next/link";

// End-of-article call to action, on the landing's closing block rather than a
// bordered card: an article ends, it does not need a second surface stacked on
// the reading column to say so. ?intent=sample matters — the generic /demo
// never repeated this offer, so the click used to land somewhere that asked for
// a team size instead of the two competitors just promised.
export function PostCta() {
  return (
    <aside className="lp-final">
      <h2>
        Get a sample digest for your{" "}
        <span className="lp-serif-accent">market</span>.
      </h2>
      <p className="sub-f">
        Tell us your product and two competitors. We&apos;ll scrape them and
        send you a real Outrival brief (the same one you&apos;d get every
        Monday) so you can see the signal before you sign up for anything.
      </p>
      <Link className="lp-btn-accent" href="/demo?intent=sample">
        Get a sample digest
      </Link>
      <p className="lp-final-micro">
        No credit card · <Link href="/auth">or start free</Link>
      </p>
    </aside>
  );
}
