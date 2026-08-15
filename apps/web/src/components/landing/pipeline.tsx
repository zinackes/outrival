import type { CSSProperties } from "react";
import { LogoMark } from "@/components/outrival/logo";
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

// Classify is the sentence above it, drawn: sixty raw changes, five of them
// lit. A list of example rows made the reader read; a field of cells makes the
// ratio visible before anything is read.
const CLASSIFY_CELLS = 60;
const CLASSIFY_HITS: Record<number, string> = {
  4: "var(--cat-pricing)",
  17: "var(--cat-product)",
  26: "var(--cat-hiring)",
  41: "var(--cat-reviews)",
  53: "var(--cat-funding)",
};

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
            <div className="cls-grid">
              {Array.from({ length: CLASSIFY_CELLS }, (_, i) => {
                const hit = CLASSIFY_HITS[i];
                return (
                  <span
                    key={i}
                    className={hit ? "cell is-hit" : "cell"}
                    style={hit ? ({ "--c": hit } as CSSProperties) : undefined}
                  />
                );
              })}
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
            <p className="wr-line">
              Vantage undercuts your $69 Pro tier on mid-market deals.
            </p>
            <span className="wr-from">written from</span>
            <div className="wr-diff">
              <span className="d-row d-del">- Pro $69/mo · 5 seat minimum</span>
              <span className="d-row d-add">+ Pro $49/mo · no seat minimum</span>
              <span className="d-row d-del">- Annual billing only</span>
              <span className="d-row d-add">+ Monthly or annual</span>
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
                <LogoMark size={22} className="ava" />
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
                <LogoMark size={22} className="ava" />
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
