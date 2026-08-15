import type { ComponentType, CSSProperties } from "react";
import type { Icon } from "@/components/icons";
import {
  BroadcastIcon,
  CardsThreeIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
} from "@/components/icons";

// The four screens the showcase proves the product with. Both layouts under
// test — the single app window and the bento grid — render these same views, so
// a copy or data fix lands in both at once.
//
// Every replica is hand-built DOM, never a raster: a screenshot carries none of
// the page's own type and goes stale the day the product moves. Each one is
// role="img" with a one-sentence label, so a screen reader gets the point
// instead of walking a pile of fake UI.

export const OVERVIEW_ROWS = [
  { name: "Meridian", n: 9, ago: "2h", act: "100%", sev: "var(--critical)" },
  { name: "Vantage", n: 7, ago: "4h", act: "78%", sev: "var(--high)" },
  { name: "Beacon", n: 4, ago: "1d", act: "44%", sev: "var(--high)" },
  { name: "Lumen", n: 3, ago: "1d", act: "31%", sev: "var(--medium)" },
  { name: "Cobalt", n: 1, ago: "2d", act: "12%", sev: "var(--low)" },
  { name: "Nimbus", n: 1, ago: "3d", act: "9%", sev: "var(--low)" },
  { name: "Halo", n: 1, ago: "5d", act: "6%", sev: "var(--low)" },
];

// Chrome bar. A panel that opens straight on its content reads as a slide; the
// name, the path and the outlined state pill are what make it read as a screen.
export function ReplicaChrome({
  replica,
  dots = false,
}: {
  replica: Replica;
  /** Window-frame traffic lights — only the full window earns them. */
  dots?: boolean;
}) {
  return (
    <div className="lp-chrome">
      {dots ? (
        <span className="lp-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {replica.owner === "Outrival" ? (
        <b>
          Out<i>rival</i>
        </b>
      ) : (
        <b>{replica.owner}</b>
      )}
      <span className="path">{replica.path}</span>
      <span
        className={replica.pillDot ? "lp-pill has-dot" : "lp-pill"}
        style={{ "--pill": replica.pillColor } as CSSProperties}
      >
        {replica.pill}
      </span>
    </div>
  );
}

function OverviewView() {
  return (
    <div
      className="lp-view lp-overview"
      role="img"
      aria-label="Outrival overview: seven competitors ranked by how much they moved this week, Meridian first with 9 signals"
    >
      {/* Only the full window has room for a toolbar; the bento cell hides it. */}
      <div className="ov-tools">
        <span className="ov-search">
          <MagnifyingGlassIcon size={14} />
          Search competitors
        </span>
        <span className="ov-seg">
          <i className="on">7 days</i>
          <i>30 days</i>
          <i>All</i>
        </span>
      </div>
      <div className="ov-head">
        <span>Competitor</span>
        <span>Activity</span>
        <span>Signals</span>
        <span>Last</span>
      </div>
      {OVERVIEW_ROWS.map((row) => (
        <div key={row.name} className="ov-row">
          <span className="ov-name">
            <i className="av">{row.name.slice(0, 1)}</i>
            {row.name}
          </span>
          <span className="ov-act">
            <i style={{ width: row.act, background: row.sev }} />
          </span>
          <span className="ov-n">{row.n}</span>
          <span className="ov-t">{row.ago}</span>
        </div>
      ))}
      <div className="ov-foot">
        <span>7 competitors · 17 source types</span>
        <span>Synced 2 min ago</span>
      </div>
    </div>
  );
}

function SignalView() {
  return (
    <div
      className="lp-view lp-sigdet"
      role="img"
      aria-label="Signal detail: Vantage cut its Pro plan 30% to $49 a month, rated critical, with the action to brief sales today"
    >
      <div className="sd-main">
        <div className="sd-body">
          <div className="sd-meta">
            <span
              className="lp-chip-cat-c"
              style={{ "--c": "var(--cat-pricing)" } as CSSProperties}
            >
              pricing
            </span>
            <span className="sd-time">2h ago · pricing page</span>
          </div>
          <p className="sd-title">Pro plan cut 30% to $49/mo, seat minimum dropped.</p>
          <div className="sd-sec">
            <span className="sd-lbl">What changed</span>
            {/* The diff in a bordered sub-panel: a nested frame is what separates
                a product screen from a paragraph in a box. */}
            <div className="sd-diff">
              <div className="sd-was">Pro · $69/user/mo · 5-seat minimum</div>
              <div className="sd-now">Pro · $49/user/mo · no seat minimum</div>
            </div>
          </div>
          <div className="sd-sec">
            <span className="sd-lbl">So what</span>
            <p>
              Undercuts your $69 Pro tier on the exact mid-market deals you&rsquo;re
              closing this quarter.
            </p>
          </div>
          <div className="sd-sec">
            <span className="sd-lbl">Action</span>
            <p>
              Brief sales on the gap today; weigh a value-add bundle before renewals.
            </p>
          </div>
        </div>
        {/* The metadata rail a real detail screen carries. It only fits in the
            window; the bento cell hides it and keeps the body full width. */}
        <div className="sd-rail">
          <div className="sd-fact">
            <i>Severity</i>
            <b style={{ color: "var(--critical)" }}>Critical</b>
          </div>
          <div className="sd-fact">
            <i>Confidence</i>
            <b>High</b>
          </div>
          <div className="sd-fact">
            <i>Detected</i>
            <b>Aug 12, 09:14</b>
          </div>
          <div className="sd-fact">
            <i>Source</i>
            <b>Pricing page</b>
          </div>
          <span className="sd-rail-lbl">Recent from Vantage</span>
          <ul className="sd-rel">
            <li>
              <i style={{ background: "var(--high)" }} />
              Business plan $16 → $14
            </li>
            <li>
              <i style={{ background: "var(--medium)" }} />
              New comparison page
            </li>
            <li>
              <i style={{ background: "var(--low)" }} />
              Docs: SSO guide added
            </li>
          </ul>
        </div>
      </div>
      <div className="sd-foot">
        <span className="sd-btn">Mark handled</span>
        <span className="sd-btn">Add to battle card</span>
        <span className="sd-src">vantage.com/pricing</span>
      </div>
    </div>
  );
}

function DigestView() {
  return (
    <div
      className="lp-view lp-digest"
      role="img"
      aria-label="Outrival weekly digest: five signals, one critical, sent Monday at 7am"
    >
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
      <div className="dg-foot">Read the 12 changes we filtered out →</div>
    </div>
  );
}

function BattleView() {
  return (
    <div
      className="lp-view lp-battle"
      role="img"
      aria-label="Battle card for Vantage: six sections, the pricing one just rewritten by a fresh signal"
    >
      <div className="bc-grid">
        <div className="bc-sec">
          <span className="bc-t">Positioning</span>
          <p className="bc-x">
            Mid-market CRM. Self-serve first, sales-assist above 20 seats.
          </p>
          <span className="bc-age">Held since Apr</span>
        </div>
        <div className="bc-sec live">
          <span className="bc-t">Pricing</span>
          <p className="bc-x">
            Pro <b>$49/mo</b>, was $69. Seat minimum dropped.
          </p>
          <span className="bc-age">Rewritten 2h ago</span>
        </div>
        <div className="bc-sec">
          <span className="bc-t">Strengths</span>
          <p className="bc-x">Fast onboarding. Native dialer. Big template library.</p>
          <span className="bc-age">Checked 6d ago</span>
        </div>
        <div className="bc-sec">
          <span className="bc-t">Weaknesses</span>
          <p className="bc-x">No SSO below Enterprise. Reporting is thin.</p>
          <span className="bc-age">Checked 6d ago</span>
        </div>
        <div className="bc-sec">
          <span className="bc-t">Objections</span>
          <p className="bc-x">
            &ldquo;They&rsquo;re cheaper.&rdquo; Counter with the migration cost.
          </p>
          <span className="bc-age">From 4 won deals</span>
        </div>
        <div className="bc-sec">
          <span className="bc-t">Landmines</span>
          <p className="bc-x">Ask about API rate limits past 10k calls a day.</p>
          <span className="bc-age">Added 2w ago</span>
        </div>
      </div>
    </div>
  );
}

export type Replica = {
  key: string;
  /** Sidebar label in the window layout. */
  nav: string;
  eyebrow: string;
  title: string;
  /** Whose screen this is — "Outrival" renders as the logotype. */
  owner: string;
  path: string;
  pill: string;
  pillColor: string;
  pillDot?: boolean;
  /** Sidebar glyph — the same one the real dashboard nav uses for this screen. */
  Icon: Icon;
  View: ComponentType;
};

export const REPLICAS: Replica[] = [
  {
    key: "overview",
    nav: "Overview",
    eyebrow: "Overview",
    title: "Every competitor, ranked by what moved.",
    owner: "Outrival",
    path: "/ overview",
    pill: "Live",
    pillColor: "var(--lp-teal)",
    pillDot: true,
    Icon: SquaresFourIcon,
    View: OverviewView,
  },
  {
    key: "signal",
    nav: "Signal detail",
    eyebrow: "Signal detail",
    title: "What changed, why it matters, what to do.",
    owner: "Vantage",
    path: "/ signals / pricing",
    pill: "Critical",
    pillColor: "var(--critical)",
    pillDot: true,
    Icon: BroadcastIcon,
    View: SignalView,
  },
  {
    key: "digest",
    nav: "Weekly digest",
    eyebrow: "Weekly digest",
    title: "One email. Monday morning. That’s it.",
    owner: "Outrival",
    path: "/ weekly digest",
    pill: "Mon 07:00",
    pillColor: "var(--lp-teal)",
    Icon: EnvelopeIcon,
    View: DigestView,
  },
  {
    key: "battle",
    nav: "Battle card",
    eyebrow: "Battle card",
    title: "Six sections. Refreshes itself when a signal moves.",
    owner: "Vantage",
    path: "/ battle card",
    pill: "Pricing refreshed 2h ago",
    pillColor: "var(--critical)",
    pillDot: true,
    Icon: CardsThreeIcon,
    View: BattleView,
  },
];
