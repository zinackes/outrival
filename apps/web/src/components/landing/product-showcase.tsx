import type { CSSProperties } from "react";
import { SilkFill } from "./silk-fill";

// Dark-body opening: the bento proof ("this is the product") and the stats
// strip. The signal-detail, digest, and battle-card minis are hand-built
// replicas of the real screens — role="img" with an aria-label so screen
// readers get one sentence instead of a pile of fake UI. Each card's Silk fill
// gets the precomputed dark mix of its tint (the shader is opaque).
export function ProductShowcase() {
  return (
    <>
      <div className="lp-dark-inner lp-bento-wide" id="product">
        <div className="lp-dark-head">
          <h2>
            This is <span className="lp-serif-accent">the product</span>.
          </h2>
          <p>
            No mockups. Every competitor move lands in one place: scored,
            explained, ready to act on.
          </p>
        </div>

        <div className="lp-cards">
          <div className="lp-card lp-card-marine">
            <SilkFill color="#14202e" />
            <span className="eyebrow">Overview</span>
            <h3>Every competitor, ranked by what moved.</h3>
            <div className="shot">
              <img
                src="/product/overview.webp"
                alt="Outrival overview: competitors ranked by activity"
              />
            </div>
          </div>

          <div className="lp-card lp-card-teal">
            <SilkFill color="#132321" />
            <span className="eyebrow">Signal detail</span>
            <h3>What changed, why it matters, what to do.</h3>
            <div
              className="lp-sigdet"
              role="img"
              aria-label="Signal detail: Vantage pricing change, critical severity"
            >
              <div className="sd-top">
                <span className="lp-chip-sev">Critical</span>
                <span
                  className="lp-chip-cat-c"
                  style={{ "--c": "var(--cat-pricing)" } as CSSProperties}
                >
                  pricing
                </span>
                <b>Vantage</b>
                <span className="sd-time">2h ago</span>
              </div>
              <p className="sd-title">
                Pro plan cut 30% to $49/mo, seat minimum dropped.
              </p>
              <div className="sd-sec">
                <span className="sd-lbl">What changed</span>
                <div className="sd-diff">
                  <div className="sd-was">Pro plan · $69/user/mo · 5-seat minimum</div>
                  <div className="sd-now">Pro plan · $49/user/mo · no seat minimum</div>
                </div>
              </div>
              <div className="sd-sec">
                <span className="sd-lbl">So what</span>
                <p>
                  Undercuts your $69 Pro tier on the exact mid-market deals
                  you&rsquo;re closing this quarter.
                </p>
              </div>
              <div className="sd-sec">
                <span className="sd-lbl">Action</span>
                <p>
                  Brief sales on the gap today; weigh a value-add bundle before
                  renewals.
                </p>
              </div>
            </div>
          </div>

          <div className="lp-card lp-card-iris">
            <SilkFill color="#242547" />
            <span className="eyebrow">Weekly digest</span>
            <h3>One email. Monday morning. That&rsquo;s it.</h3>
            <div
              className="lp-digest"
              role="img"
              aria-label="Outrival weekly digest, excerpt"
            >
              <div className="dg-top">
                <b>
                  Out<i>rival</i>
                </b>
                <span className="path">/ weekly digest</span>
                <span className="tab">This week</span>
              </div>
              <div className="dg-stats">
                <div>
                  <i>Signals</i>
                  <b>5</b>
                </div>
                <div>
                  <i>Critical</i>
                  <b>1</b>
                </div>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-critical" />
                <span className="chip-cat">product</span>
                <span className="txt">
                  <b>Meridian</b>: launches usage-based billing
                </span>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-high" />
                <span className="chip-cat">pricing</span>
                <span className="txt">
                  <b>Vantage</b>: Business plan $16 → $14/seat
                </span>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-high" />
                <span className="chip-cat">funding</span>
                <span className="txt">
                  <b>Beacon</b>: raises Series E, $200M
                </span>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-medium" />
                <span className="chip-cat">hiring</span>
                <span className="txt">
                  <b>Lumen</b>: opens 3 AI Research roles
                </span>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-medium" />
                <span className="chip-cat">reviews</span>
                <span className="txt">
                  <b>Cobalt</b>: Trustpilot slips 4.4 → 4.2
                </span>
              </div>
            </div>
          </div>

          <div className="lp-card lp-card-bordeaux">
            <SilkFill color="#331d28" />
            <span className="eyebrow">Battle card</span>
            <h3>Six sections. Refreshes itself when a signal moves.</h3>
            <div
              className="lp-battle"
              role="img"
              aria-label="Battle card for Vantage: six sections, pricing just refreshed by a signal"
            >
              <div className="bc-head">
                <b>Vantage</b>
                <span className="path">/ battle card</span>
                <span className="fresh">Pricing refreshed 2h ago</span>
              </div>
              <div className="bc-grid">
                <div className="bc-sec">
                  <span className="bc-t">Positioning</span>
                  <p className="bc-x">
                    Mid-market CRM. Self-serve first, sales-assist above 20 seats.
                  </p>
                </div>
                <div className="bc-sec live">
                  <span className="bc-t">Pricing</span>
                  <p className="bc-x">
                    Pro <b>$49/mo</b>, was $69. Seat minimum dropped.
                  </p>
                </div>
                <div className="bc-sec">
                  <span className="bc-t">Strengths</span>
                  <p className="bc-x">
                    Fast onboarding. Native dialer. Big template library.
                  </p>
                </div>
                <div className="bc-sec">
                  <span className="bc-t">Weaknesses</span>
                  <p className="bc-x">No SSO below Enterprise. Reporting is thin.</p>
                </div>
                <div className="bc-sec">
                  <span className="bc-t">Objections</span>
                  <p className="bc-x">
                    &ldquo;They&rsquo;re cheaper.&rdquo; Counter with the migration
                    cost.
                  </p>
                </div>
                <div className="bc-sec">
                  <span className="bc-t">Landmines</span>
                  <p className="bc-x">
                    Ask about API rate limits past 10k calls a day.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="lp-stats">
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <b>12:1</b>
            <span>changes per signal that needs action</span>
          </div>
          <div className="lp-stat">
            <b>17</b>
            <span>source types</span>
          </div>
          <div className="lp-stat">
            <b>≤5 min</b>
            <span>critical alert latency</span>
          </div>
          <div className="lp-stat">
            <b>EU</b>
            <span>data storage</span>
          </div>
        </div>
        <p className="lp-stats-note">Measured on production, July 2026.</p>
      </div>
    </>
  );
}
