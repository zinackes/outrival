export function Pipeline() {
  return (
    <section
      className="section"
      id="pipeline"
      style={{
        background: "var(--background-2)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="wrap">
        <div className="head-B">
          <h2>
            From scraped HTML
            <br />
            to strategic signal.
          </h2>
          <p className="lede">
            A real example: a change detected on Linear&apos;s pricing page.
            Here&apos;s exactly what happens between the scrape and the moment
            it shows up in your digest.
          </p>
        </div>

        <div className="pipe-card">
          <div className="pipe-source">
            <span className="pipe-source-dot"></span>
            <span>
              <span className="url">linear.app/pricing</span> · snapshot scraped
            </span>
            <span className="ts">2026-05-25T09:31:14Z</span>
          </div>

          <div
            className="diff-block scroll-mini"
            style={{ maxHeight: 200, overflowY: "auto" }}
          >
            <div className="diff-line">
              <span className="marker">  </span>
              {'<div class="plan plan-business">'}
            </div>
            <div className="diff-line">
              <span className="marker">  </span>
              {"  <h3>Business</h3>"}
            </div>
            <div className="diff-line del">
              <span className="marker">-</span>
              {'  <span class="price">$16</span><span>/seat/mo</span>'}
            </div>
            <div className="diff-line add">
              <span className="marker">+</span>
              {'  <span class="price">$14</span><span>/seat/mo</span>'}
            </div>
            <div className="diff-line add">
              <span className="marker">+</span>
              {'  <span class="badge">Save 12% annually</span>'}
            </div>
            <div className="diff-line">
              <span className="marker">  </span>
              {'  <ul class="features">'}
            </div>
            <div className="diff-line del">
              <span className="marker">-</span>
              {"    <li>Up to 250 members</li>"}
            </div>
            <div className="diff-line add">
              <span className="marker">+</span>
              {"    <li>Unlimited members</li>"}
            </div>
          </div>

          <div className="pipe-steps">
            <div className="pipe-cell">
              <div className="pipe-cell-head">
                <span className="pipe-cell-tag">step 1</span>
                <span className="pipe-cell-name">groq · llama-3.3-70b</span>
              </div>
              <div className="kv">
                <span className="kv-key">category</span>
                <span className="kv-val">pricing</span>
                <span className="kv-key">severity</span>
                <span className="kv-val crit">critical</span>
                <span className="kv-key">significant</span>
                <span className="kv-val">true</span>
                <span className="kv-key">latency</span>
                <span className="kv-val">348 ms</span>
              </div>
            </div>

            <div className="pipe-cell">
              <div className="pipe-cell-head">
                <span className="pipe-cell-tag">step 2</span>
                <span className="pipe-cell-name">claude sonnet 4.6</span>
              </div>
              <div className="pipe-cell-out">
                <b>Linear repositions Business as the entry tier.</b> The gap
                with your Pro plan tightens from $4 to $2, and the seat cap
                disappears.
              </div>
            </div>

            <div className="pipe-cell">
              <div className="pipe-cell-head">
                <span className="pipe-cell-tag">step 3</span>
                <span className="pipe-cell-name">→ signal · alert</span>
              </div>
              <div className="pipe-cell-out">
                Stored in DB · pushed to Slack{" "}
                <span className="mono" style={{ color: "var(--muted)" }}>
                  #competitive-intel
                </span>
                .
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    background: "var(--background-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span className="signal-sev critical"></span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--muted)",
                    }}
                  >
                    PRICING · CRITICAL
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p
          style={{
            marginTop: 24,
            color: "var(--muted-2)",
            fontSize: 13,
            textAlign: "center",
            fontFamily: "var(--font-mono)",
          }}
        >
          ~70 changes scanned produce 1 signal · you don&apos;t pay Claude to
          read noise.
        </p>
      </div>
    </section>
  );
}
