import type { CSSProperties } from "react";
import { SilkFill } from "./silk-fill";

// Scan's vignette is deliberately longer than its card: the cloud is cropped
// mid-row and faded out, so the eye reads "there is more of this than fits"
// without a number claiming it.
// Real source types only (packages/db sourceTypeEnum) — the review aggregators
// were retired for legal reasons, so no G2 and no Capterra.
const SCAN_SOURCES = [
  "homepage",
  "pricing",
  "changelog",
  "jobs",
  "blog",
  "docs",
  "Trustpilot",
  "status page",
  "roadmap",
  "App Store",
  "LinkedIn",
  "news",
  "sitemap",
  "GitHub",
  "comparison pages",
  "subdomains",
  "Shopify reviews",
  "integrations",
];

// Classify shows the ratio the copy claims: the two rows that earn a category
// sit among the ones filed as noise, and the stack is cut before it ends.
const CLASSIFY_ROWS: {
  raw: string;
  cat?: string;
  c?: string;
  sev?: string;
}[] = [
  { raw: "pricing page edited", cat: "pricing", c: "var(--cat-pricing)", sev: "var(--high)" },
  { raw: "footer copy changed" },
  { raw: "4 reviews added", cat: "reviews", c: "var(--cat-reviews)", sev: "var(--medium)" },
  { raw: "cookie banner tweak" },
  { raw: "2 AE roles opened", cat: "hiring", c: "var(--cat-hiring)", sev: "var(--medium)" },
  { raw: "hero image swapped" },
  { raw: "changelog: SSO shipped", cat: "product", c: "var(--cat-product)", sev: "var(--high)" },
  { raw: "nav link reordered" },
];

// The five-step pipeline, raw change → decision. Each step's accent (--pc)
// and Silk fill echo the stage's signal hue: teal scan, medium-amber classify,
// iris write, low-blue digest, critical-red act. The visualisations are
// decorative miniatures (aria-hidden); the copy above them carries the story.
export function Pipeline() {
  return (
    <div className="lp-dark-inner lp-pipe-wrap">
      <div className="lp-dark-head">
        <h2>
          From raw change to <span className="lp-serif-accent">decision</span>.
        </h2>
      </div>
      <div className="lp-pipe-grid">
        <div
          className="lp-pstep"
          style={{ "--pc": "var(--lp-teal)" } as CSSProperties}
        >
          <SilkFill color="#202a29" />
          <div className="pstep-head">
            <span className="pstep-num">1</span>
            <h3>Scan</h3>
          </div>
          <p>
            Everything they publish: homepage, pricing, jobs, reviews, news.
            Continuously.
          </p>
          <div className="pstep-viz viz-bleed" aria-hidden>
            <div className="src-cloud">
              {SCAN_SOURCES.map((src) => (
                <span key={src} className="src-chip">
                  <span className="dot" />
                  {src}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          className="lp-pstep"
          style={{ "--pc": "var(--medium)" } as CSSProperties}
        >
          <SilkFill color="#302921" />
          <div className="pstep-head">
            <span className="pstep-num">2</span>
            <h3>Classify</h3>
          </div>
          <p>
            Every change gets a category and a severity. About 1 in 12 is worth
            your time.
          </p>
          <div className="pstep-viz viz-bleed" aria-hidden>
            <div className="cls-stack">
              {CLASSIFY_ROWS.map((row) => (
                <div
                  key={row.raw}
                  className={row.cat ? "cls-row" : "cls-row is-noise"}
                >
                  <span className="cls-noise">{row.raw}</span>
                  <span className="cls-arrow">→</span>
                  {row.cat ? (
                    <>
                      <span
                        className="lp-chip-cat-c"
                        style={{ "--c": row.c } as CSSProperties}
                      >
                        {row.cat}
                      </span>
                      <span
                        className="lp-sev-dot"
                        style={{ background: row.sev }}
                      />
                    </>
                  ) : (
                    <span className="cls-drop">noise</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className="lp-pstep"
          style={{ "--pc": "var(--lp-iris-b)" } as CSSProperties}
        >
          <SilkFill color="#262533" />
          <div className="pstep-head">
            <span className="pstep-num">3</span>
            <h3>Write</h3>
          </div>
          <p>AI writes the so-what and the one action, in plain English.</p>
          <div className="pstep-viz viz-bleed" aria-hidden>
            <div className="lp-sig-card">
              <div className="sig-chips">
                <span className="lp-chip-sev">Critical</span>
                <span
                  className="lp-chip-cat-c"
                  style={{ "--c": "var(--cat-pricing)" } as CSSProperties}
                >
                  pricing
                </span>
                <b>Vantage</b>
              </div>
              <div>Pro plan cut 30% to $49/mo, seat minimum dropped.</div>
              <span className="lbl">So what</span>
              <div className="txt-muted">
                Undercuts your $69 Pro tier on mid-market deals.
              </div>
              <span className="lbl">Do this</span>
              <div className="txt-muted">
                Give sales the objection line before Monday&rsquo;s calls.
              </div>
              <span className="lbl">Source</span>
              <div className="txt-muted">vantage.io/pricing · captured 06:12</div>
            </div>
          </div>
        </div>

        <div
          className="lp-pstep lp-pstep-digest"
          style={{ "--pc": "var(--low)" } as CSSProperties}
        >
          <SilkFill color="#1e2533" />
          <div className="pstep-head">
            <span className="pstep-num">4</span>
            <h3>Digest</h3>
          </div>
          <p>The handful that matter, in one email. Monday morning.</p>
          <div className="pstep-viz viz-bleed" aria-hidden>
            <div className="dg-frame">
              <div className="dg-bar">
                <b>Your week in 6 signals</b>
                <i>Mon 07:00</i>
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
                  <b>Vantage</b>: rating slips 4.6 → 4.3 on onboarding
                </span>
              </div>
              <div className="dg-row">
                <span className="dot lp-sev-low" />
                <span className="chip-cat">content</span>
                <span className="txt">
                  <b>Meridian</b>: publishes a migration guide off your API
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className="lp-pstep lp-pstep-act"
          style={{ "--pc": "var(--critical)" } as CSSProperties}
        >
          <SilkFill color="#321f23" />
          <div className="pstep-head">
            <span className="pstep-num">5</span>
            <h3>Act</h3>
          </div>
          <p>Adopt the move, or forget it. You decide in seconds.</p>
          <div className="pstep-viz viz-bleed" aria-hidden>
            <div className="act-thread">
              <div className="act-msg">
                <span className="ava" />
                <div>
                  <div className="act-meta">
                    <b>Outrival</b>
                    <i>09:04</i>
                  </div>
                  <div className="act-txt">
                    Meridian launches usage-based billing.
                  </div>
                  <div className="act-reacts">
                    <span className="rc rc-done">✓ Adopted</span>
                    <span className="rc">Sales briefed</span>
                    <span className="rc">Added to Q3 plan</span>
                  </div>
                </div>
              </div>
              <div className="act-msg">
                <span className="ava" />
                <div>
                  <div className="act-meta">
                    <b>Outrival</b>
                    <i>09:04</i>
                  </div>
                  <div className="act-txt">
                    Vantage cuts Pro to $49/mo, seat minimum dropped.
                  </div>
                  <div className="act-reacts">
                    <span className="rc">Dismissed</span>
                    <span className="rc">Snooze 30d</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
