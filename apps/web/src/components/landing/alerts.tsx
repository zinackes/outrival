import { ArrowUpRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/dashboard/user-avatar";

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

// Shared window chrome so both mockups read as one system (a titlebar with the
// source glyph on the left).
function MockHeader({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-background-2 px-4 py-2.5 font-mono text-xs text-text-muted">
      {icon} {label}
    </div>
  );
}

export function Alerts() {
  return (
    <section className="py-16 sm:py-24" id="alerts" data-reveal>
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Critical = can&apos;t
            <br />
            wait until Monday.
          </h2>
          <p className="text-text-muted leading-relaxed">
            For a high or critical signal, we push the alert to Slack, email, or
            webhook within minutes — with just enough context to act.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Slack */}
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/5 dark:shadow-black/30">
            <MockHeader icon={<SlackGlyph size={14} />} label="#competitive-intel" />
            <div className="p-4">
              <div className="flex gap-3">
                <UserAvatar seed="Outrival" size={36} className="mt-0.5 rounded-md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Outrival</span>
                    <span className="rounded bg-surface-2 px-1 py-px font-mono text-meta uppercase tracking-wide text-text-subtle">
                      app
                    </span>
                    <span className="font-mono text-meta text-text-subtle">
                      09:42
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-muted">
                    <span className="inline-flex items-center gap-1.5 align-middle">
                      <span className="size-1.5 rounded-full bg-critical" />
                      <span className="font-medium text-critical">Critical</span>
                    </span>{" "}
                    signal at <b className="text-foreground">Vantage</b> ·{" "}
                    <span className="font-mono text-xs">pricing</span>
                  </div>
                  {/* Slack-style left-border attachment */}
                  <div className="mt-2.5 rounded-r-md border-l-2 border-critical bg-background-2 p-3 text-sm text-text-muted">
                    <div className="mb-1 font-mono text-meta text-text-subtle">
                      vantage.app/pricing · diff at 09:31
                    </div>
                    <b className="text-foreground">Business</b> plan:{" "}
                    <b className="text-foreground">$16/seat</b> →{" "}
                    <b className="text-foreground">$14/seat</b>. &quot;Save 12%
                    annually&quot; badge added, the 250-member cap removed.
                  </div>
                  <div className="mt-3.5 flex gap-2">
                    <Button variant="outline" size="sm">
                      Open the signal
                    </Button>
                    <Button variant="ghost" size="sm">
                      See the diff
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/5 dark:shadow-black/30">
            <MockHeader icon={<Mail size={14} />} label="alerts@outrival.app" />
            <div className="border-b border-border bg-background-2 px-4 py-3">
              <div className="text-sm font-semibold">
                Vantage repositions Business — action required
              </div>
              <div className="mt-1 flex items-center gap-2">
                <UserAvatar seed="Outrival" size={18} className="rounded-md" />
                <span className="font-mono text-meta text-text-subtle">
                  Outrival · to you@team.com · 09:42
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-3 p-4 text-sm leading-relaxed text-text-muted">
              <p>
                A <b className="text-foreground">critical</b> signal was just
                detected at Vantage.
              </p>
              <div className="rounded-md border border-border bg-background-2 p-3">
                <div className="text-meta font-medium uppercase tracking-wide text-text-subtle">
                  Insight
                </div>
                <p className="mt-1">
                  Vantage repositions Business as the entry tier — the gap with
                  your Pro plan tightens from $4 to $2.
                </p>
              </div>
              <div className="rounded-md border border-border bg-background-2 p-3">
                <div className="text-meta font-medium uppercase tracking-wide text-text-subtle">
                  Recommended action
                </div>
                <p className="mt-1">
                  Revisit the pricing grid before the next public release —
                  especially the &quot;Pro vs Business&quot; messaging.
                </p>
              </div>
            </div>
            <div className="border-t border-border px-4 py-3">
              <Button variant="outline" size="sm">
                View the full signal <ArrowUpRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
