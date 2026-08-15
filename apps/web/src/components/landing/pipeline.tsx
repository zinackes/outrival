import type { CSSProperties } from "react";
import { SilkFill } from "./silk-fill";

// Scan's vignette is deliberately longer than its card: the cloud is cropped
// mid-row and faded out, so the eye reads "there is more of this than fits"
// without a number claiming it.
const SCAN_SOURCES = [
  "homepage",
  "pricing",
  "changelog",
  "jobs",
  "blog",
  "docs",
  "G2",
  "Capterra",
  "release notes",
  "LinkedIn",
  "Trustpilot",
  "news",
  "status page",
  "case studies",
  "App Store",
  "sitemap",
  "ads",
  "integrations",
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
          <div className="pstep-viz" aria-hidden>
            <div className="cls-row">
              <span className="cls-noise">pricing page edited</span>
              <span className="cls-arrow">→</span>
              <span
                className="lp-chip-cat-c"
                style={{ "--c": "var(--cat-pricing)" } as CSSProperties}
              >
                pricing
              </span>
              <span className="lp-sev-dot" style={{ background: "var(--high)" }} />
            </div>
            <div className="cls-row">
              <span className="cls-noise">4 reviews added</span>
              <span className="cls-arrow">→</span>
              <span
                className="lp-chip-cat-c"
                style={{ "--c": "var(--cat-reviews)" } as CSSProperties}
              >
                reviews
              </span>
              <span
                className="lp-sev-dot"
                style={{ background: "var(--medium)" }}
              />
            </div>
            <p className="src-more">Everything else is filed as noise.</p>
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
          <div className="pstep-viz" aria-hidden>
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
          <div className="pstep-viz" aria-hidden>
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
          <div className="pstep-viz" aria-hidden>
            <div className="lp-sig-card">
              <div className="sig-chips">
                <span
                  className="lp-chip-cat-c"
                  style={{ "--c": "var(--cat-product)" } as CSSProperties}
                >
                  product
                </span>
                <b>Meridian</b>
              </div>
              <div>Meridian launches usage-based billing.</div>
              <div className="lp-act-done">
                <span className="tick">✓</span>Adopted · sales briefed the same
                morning
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
