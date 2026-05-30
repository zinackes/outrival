export function Categories() {
  return (
    <section className="section" id="signals">
      <div className="wrap">
        <div className="head-C">
          <h2>
            Six categories.
            <br />
            Four severities.
          </h2>
          <p className="lede">
            Every signal carries a category and a severity. You filter on what
            matters for your role — pricing for the CFO, hiring for talent,
            reviews for product.
          </p>
        </div>

        <div className="cats-bento">
          <div className="cat-feature">
            <div className="badge">
              <span className="signal-sev critical"></span> Critical example
            </div>
            <h3>Pricing</h3>
            <p
              className="muted"
              style={{ fontSize: 14, lineHeight: 1.55 }}
            >
              Plan added or removed · price change · billing model shift (per
              seat → flat) · new billing period · feature gating.
            </p>
            <div className="quote">
              Linear drops Business from $16 → $14/seat and removes the 250
              member cap. Read: Business gets repositioned as the entry tier —
              your Pro plan loses $2 of competitive headroom.
            </div>
          </div>

          <div className="cat-small">
            <div className="cat-small-grid">
              <div className="cat-mini">
                <div className="cat-mini-head">
                  <span className="cat-mini-cat">product</span>
                  <span className="sev-pill">
                    <span className="signal-sev high"></span> high
                  </span>
                </div>
                <div className="cat-mini-title">Product</div>
                <div className="cat-mini-eg">
                  Major releases, UX overhauls, strategic feature launches.
                </div>
              </div>
              <div className="cat-mini">
                <div className="cat-mini-head">
                  <span className="cat-mini-cat">hiring</span>
                  <span className="sev-pill">
                    <span className="signal-sev high"></span> high
                  </span>
                </div>
                <div className="cat-mini-title">Hiring</div>
                <div className="cat-mini-eg">
                  First roles in a brand-new department, geographic expansion.
                </div>
              </div>
              <div className="cat-mini">
                <div className="cat-mini-head">
                  <span className="cat-mini-cat">reviews</span>
                  <span className="sev-pill">
                    <span className="signal-sev medium"></span> medium
                  </span>
                </div>
                <div className="cat-mini-title">Reviews</div>
                <div className="cat-mini-eg">
                  Drop in G2/Capterra score, negative sentiment at scale.
                </div>
              </div>
              <div className="cat-mini">
                <div className="cat-mini-head">
                  <span className="cat-mini-cat">content</span>
                  <span className="sev-pill">
                    <span className="signal-sev medium"></span> medium
                  </span>
                </div>
                <div className="cat-mini-title">Content</div>
                <div className="cat-mini-eg">
                  Editorial post signalling repositioning, public manifesto.
                </div>
              </div>
            </div>
          </div>

          <div
            className="cat-mini"
            style={{
              gridColumn: "span 6",
              flexDirection: "row",
              gap: 24,
              alignItems: "center",
              padding: 22,
            }}
          >
            <div
              className="cat-mini-head"
              style={{
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <span className="cat-mini-cat">funding</span>
              <span className="sev-pill">
                <span className="signal-sev low"></span> low
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <span className="cat-mini-title">Funding</span>
              <span className="muted" style={{ fontSize: 14 }}>
                Funding rounds detected via TechCrunch, press, Crunchbase.
                Strategic context but rarely actionable short-term — hence the
                default low severity.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
