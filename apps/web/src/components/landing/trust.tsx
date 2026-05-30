export function Trust() {
  return (
    <section className="trust">
      <div className="wrap trust-grid">
        <div className="trust-narrative">
          <div className="eyebrow" style={{ color: "var(--accent)" }}>
            What it actually solves
          </div>
          <p className="trust-line">
            Monday morning, you read <b>12 signals that matter</b> instead of
            scrolling through <b>847 changes</b>. The triage is the AI&apos;s
            job — not yours.
          </p>
        </div>
        <div className="trust-specs">
          <div className="trust-spec">
            <div className="trust-spec-num">70<span>:1</span></div>
            <div className="trust-spec-label">noise to signal ratio</div>
          </div>
          <div className="trust-spec">
            <div className="trust-spec-num">10</div>
            <div className="trust-spec-label">sources per competitor</div>
          </div>
          <div className="trust-spec">
            <div className="trust-spec-num">
              ≤ 5<span>min</span>
            </div>
            <div className="trust-spec-label">critical alert latency</div>
          </div>
          <div className="trust-spec">
            <div className="trust-spec-num">100<span>%</span></div>
            <div className="trust-spec-label">EU · Hetzner · Railway · R2</div>
          </div>
        </div>
      </div>
    </section>
  );
}
