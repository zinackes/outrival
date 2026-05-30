export function Quote() {
  return (
    <section className="case-block">
      <div className="wrap">
        <div className="case-inner">
          <div className="case-left">
            <div className="eyebrow" style={{ color: "var(--accent)" }}>
              Case · Series A B2B SaaS
            </div>
            <div className="case-quote">
              We replaced a <b>2h Monday slot</b> with <b>10 minutes of
              reading</b>. And we heard about Linear&apos;s repricing{" "}
              <b>before our own sales team</b>.
            </div>
            <div className="case-attribution">
              <div className="case-author">Head of Product</div>
              <div className="case-meta">
                B2B SaaS · Paris · 18 people · 14 competitors monitored
              </div>
            </div>
          </div>
          <div className="case-right">
            <div className="case-stat">
              <div className="case-stat-num">8h<span>/wk</span></div>
              <div className="case-stat-label">manual research replaced</div>
            </div>
            <div className="case-stat">
              <div className="case-stat-num">3<span>d</span></div>
              <div className="case-stat-label">
                ahead of sales on a competitor repricing
              </div>
            </div>
            <div className="case-stat">
              <div className="case-stat-num">€0</div>
              <div className="case-stat-label">external CI tooling</div>
            </div>
          </div>
        </div>
        <div className="case-footnote">
          Anonymized at the customer&apos;s request · NDA in progress ·
          identifiable company and verifiable figures available under NDA —{" "}
          <a href="mailto:hello@outrival.io">hello@outrival.io</a>
        </div>
      </div>
    </section>
  );
}
