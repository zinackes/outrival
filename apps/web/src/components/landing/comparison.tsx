export function Comparison() {
  return (
    <section className="section" id="compare">
      <div className="wrap">
        <div className="head-A">
          <div>
            <h2>
              Vs doing it by hand.
              <br />
              Vs the legacy tools.
            </h2>
          </div>
          <p className="lede">
            Three approaches exist. Manual tracking (a weekly calendar slot and
            a Notion), the legacy battle-card tools (Klue, Crayon), and us.
            Here&apos;s what changes.
          </p>
        </div>
        <div className="compare">
          <div className="compare-row head">
            <div className="compare-cell"></div>
            <div className="compare-cell">Manual</div>
            <div className="compare-cell">Legacy CI</div>
            <div className="compare-cell us">Outrival</div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">
              Continuous scraping, zero re-wiring
            </div>
            <div className="compare-cell">
              <span className="no">no</span>
            </div>
            <div className="compare-cell">
              <span className="partial">partial</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">yes · 8+ sources</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">
              Strategic insight generated (so-what + action)
            </div>
            <div className="compare-cell">
              <span className="no">write it yourself</span>
            </div>
            <div className="compare-cell">
              <span className="partial">templates</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">Claude Sonnet 4.6</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">Noise filtered before analysis</div>
            <div className="compare-cell">
              <span className="no">no</span>
            </div>
            <div className="compare-cell">
              <span className="no">everything passes through</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">Llama 70B classifier</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">
              Real-time alert on critical signal
            </div>
            <div className="compare-cell">
              <span className="no">no</span>
            </div>
            <div className="compare-cell">
              <span className="partial">email batch</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">Slack &lt; 5 min</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">Data hosted in EU</div>
            <div className="compare-cell">
              <span className="partial">depends on tools</span>
            </div>
            <div className="compare-cell">
              <span className="no">mostly US</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">Hetzner · Railway EU</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">Setup</div>
            <div className="compare-cell">
              <span className="partial">2h / week</span>
            </div>
            <div className="compare-cell">
              <span className="partial">2-4 weeks</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">10 minutes</span>
            </div>
          </div>
          <div className="compare-row">
            <div className="compare-cell">Typical monthly cost</div>
            <div className="compare-cell">
              <span className="partial">8h × salary</span>
            </div>
            <div className="compare-cell">
              <span className="partial">$800–$2k</span>
            </div>
            <div className="compare-cell us">
              <span className="yes">€29 to €199</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
