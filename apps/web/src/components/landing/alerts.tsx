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
    <section className="section" id="alerts">
      <div className="wrap">
        <div className="head-A">
          <div>
            <h2>
              Critical = can&apos;t
              <br />
              wait until Monday.
            </h2>
          </div>
          <p className="lede">
            For a high or critical signal, we push the alert to Slack, email,
            or webhook within the minute — with just enough context to act.
          </p>
        </div>
        <div className="alert-grid">
          <div className="alert-card">
            <div className="alert-card-head">
              <SlackGlyph size={14} /> #competitive-intel
            </div>
            <div className="alert-card-body">
              <div className="slack-msg">
                <div className="slack-avatar">O</div>
                <div style={{ flex: 1 }}>
                  <div>
                    <span className="slack-name">Outrival</span>
                    <span className="slack-time">today · 09:42</span>
                  </div>
                  <div className="slack-body">
                    <span style={{ color: "var(--accent)" }}>Critical</span>{" "}
                    signal at <b>Linear</b> ·{" "}
                    <span className="mono" style={{ color: "var(--muted)" }}>
                      pricing
                    </span>
                  </div>
                  <div className="slack-quote">
                    <div className="slack-quote-meta">
                      linear.app/pricing · diff at 09:31
                    </div>
                    <b>Business</b> plan: <b>$16/seat</b> → <b>$14/seat</b>.
                    &quot;Save 12% annually&quot; badge added, the 250-member
                    cap removed.
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

          <div className="alert-card">
            <div className="alert-card-head">
              <Mail size={14} /> alerts@outrival.io
            </div>
            <div className="alert-card-body" style={{ padding: 0 }}>
              <div className="email-head">
                <div className="email-subject">
                  Linear repositions Business — action required
                </div>
                <div className="email-from">
                  from Outrival · to you@team.com · 09:42
                </div>
              </div>
              <div className="email-body">
                <p>
                  A <b>critical</b> signal was just detected at Linear.
                </p>
                <p>
                  <b>Insight.</b> Linear repositions Business as the entry tier
                  — the gap with your Pro plan tightens from $4 to $2.
                </p>
                <p>
                  <b>Recommended action.</b> Revisit the pricing grid before
                  the next public release, especially the &quot;Pro vs
                  Business&quot; messaging.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
