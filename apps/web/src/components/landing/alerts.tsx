import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

function SlackGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="10" width="6" height="3" rx="1.5" />
      <rect x="11" y="3" width="3" height="6" rx="1.5" />
      <rect x="15" y="11" width="6" height="3" rx="1.5" />
      <rect x="10" y="15" width="3" height="6" rx="1.5" />
    </svg>
  );
}

export function Alerts() {
  return (
    <section className="py-20 sm:py-28" id="alerts">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Critical = can&apos;t
            <br />
            wait until Monday.
          </h2>
          <p className="text-text-muted leading-relaxed">
            For a high or critical signal, we push the alert to Slack, email,
            or webhook within the minute — with just enough context to act.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-background-2 px-4 py-2.5 font-mono text-xs text-text-muted">
              <SlackGlyph size={14} /> #competitive-intel
            </div>
            <div className="p-4">
              <div className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                  O
                </div>
                <div className="flex-1">
                  <div>
                    <span className="text-sm font-semibold">Outrival</span>
                    <span className="ml-2 font-mono text-[11px] text-text-subtle">
                      today · 09:42
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-text-muted">
                    <span className="text-primary">Critical</span> signal at{" "}
                    <b className="text-foreground">Linear</b> ·{" "}
                    <span className="font-mono">pricing</span>
                  </div>
                  <div className="mt-2 rounded-md border-l-2 border-border bg-background-2 p-3 text-sm text-text-muted">
                    <div className="mb-1 font-mono text-[11px] text-text-subtle">
                      linear.app/pricing · diff at 09:31
                    </div>
                    <b className="text-foreground">Business</b> plan:{" "}
                    <b className="text-foreground">$16/seat</b> →{" "}
                    <b className="text-foreground">$14/seat</b>. &quot;Save 12%
                    annually&quot; badge added, the 250-member cap removed.
                  </div>
                  <div className="mt-3.5 flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <span>Open the signal</span>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <span>See the diff</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-background-2 px-4 py-2.5 font-mono text-xs text-text-muted">
              <Mail size={14} /> alerts@outrival.io
            </div>
            <div>
              <div className="border-b border-border bg-background-2 px-4 py-3">
                <div className="text-sm font-semibold">
                  Linear repositions Business — action required
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-text-subtle">
                  from Outrival · to you@team.com · 09:42
                </div>
              </div>
              <div className="space-y-3 p-4 text-sm leading-relaxed text-text-muted">
                <p>
                  A <b className="text-foreground">critical</b> signal was just
                  detected at Linear.
                </p>
                <p>
                  <b className="text-foreground">Insight.</b> Linear repositions
                  Business as the entry tier — the gap with your Pro plan
                  tightens from $4 to $2.
                </p>
                <p>
                  <b className="text-foreground">Recommended action.</b> Revisit
                  the pricing grid before the next public release, especially
                  the &quot;Pro vs Business&quot; messaging.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
