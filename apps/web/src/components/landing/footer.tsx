export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="#" className="logo">
              Out<span className="accent">rival</span>
            </a>
            <p className="footer-tagline">
              Competitive intelligence isn&apos;t a weekly calendar slot
              anymore. It&apos;s a Monday morning brief.
            </p>
            <div className="footer-pin">
              <span className="footer-pin-dot" /> Made in Paris · hosted in EU
            </div>
          </div>
          <div className="footer-cols">
            <div className="footer-col">
              <div className="footer-col-head">Product</div>
              <a href="#sources">Sources</a>
              <a href="#pipeline">Pipeline</a>
              <a href="#signals">Signals</a>
              <a href="#compare">Compare</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="footer-col">
              <div className="footer-col-head">Resources</div>
              <a href="#faq">FAQ</a>
              <a href="/changelog">Changelog</a>
              <a href="/docs">API docs</a>
              <a href="mailto:hello@outrival.io">Contact</a>
            </div>
            <div className="footer-col">
              <div className="footer-col-head">Legal</div>
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
              <a href="/dpa">DPA</a>
              <a href="/status">Status</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <div>© 2026 Outrival SAS · 8 rue de la Paix, 75002 Paris</div>
          <div className="footer-bottom-meta">
            <span>RCS Paris 932 481 297</span>
            <span>v0.7.0</span>
            <a href="/status" className="footer-status">
              <span className="footer-status-dot" /> All systems operational
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
