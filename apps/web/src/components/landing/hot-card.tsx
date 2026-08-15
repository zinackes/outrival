// The price-position statement: €29 against the $29,000 incumbents, argued in
// one hot bordeaux card with the honest comparison grid under it. The claims
// are third-party estimates and say so, dated, in the copy.
export function HotCard() {
  return (
    <div className="lp-dark-inner lp-hot" id="compare">
      <div className="lp-hot-card">
        <h2>
          €29. Not <span className="lp-serif-accent">$29,000</span>.
        </h2>
        <div className="lp-hot-copy">
          <p>
            Competitive intelligence used to cost a salary and a sales call.
            Klue and Crayon start around $20,000 to $40,000 a year, with prices
            you have to ask for. Outrival is €29 to €199, published, self-serve,
            cancel in one click.
          </p>
          <p className="lp-hot-note">Third-party estimates, July 2026.</p>
          <p className="lp-hot-links">
            <a href="/vs/crayon">Outrival vs Crayon</a> ·{" "}
            <a href="/vs/klue">Outrival vs Klue</a>
          </p>
        </div>
        <div className="lp-hot-table">
          <div className="lp-ht-grid">
            <div className="ht-h" />
            <div className="ht-h">Manual</div>
            <div className="ht-h">Legacy CI</div>
            <div className="ht-h ht-us">Outrival</div>

            <div className="ht-label">Continuous scraping, zero re-wiring</div>
            <div className="ht-no">no</div>
            <div className="ht-mid">partial</div>
            <div className="ht-us">yes · 15+ sources</div>

            <div className="ht-label">Strategic insight (so-what + action)</div>
            <div className="ht-no">write it yourself</div>
            <div className="ht-mid">templates</div>
            <div className="ht-us">AI-written</div>

            <div className="ht-label">Noise filtered before analysis</div>
            <div className="ht-no">no</div>
            <div className="ht-no">everything passes through</div>
            <div className="ht-us">AI classifier</div>

            <div className="ht-label">Real-time alert on critical signal</div>
            <div className="ht-no">no</div>
            <div className="ht-mid">email batch</div>
            <div className="ht-us">Slack &lt; 5 min</div>

            <div className="ht-label">Data hosted in EU</div>
            <div className="ht-mid">depends on tools</div>
            <div className="ht-no">mostly US</div>
            <div className="ht-us">yes, 100%</div>

            <div className="ht-label">Setup</div>
            <div className="ht-mid">2h / week</div>
            <div className="ht-mid">2–4 weeks</div>
            <div className="ht-us">5 minutes</div>

            <div className="ht-label">Typical monthly cost</div>
            <div className="ht-mid">8h × salary</div>
            <div className="ht-mid">$800–$2k</div>
            <div className="ht-us">€29 to €199</div>
          </div>
        </div>
      </div>
    </div>
  );
}
