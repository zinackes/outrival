// Final CTA on paper. The sample-fold replaces the old SampleOffer section:
// the hand-written digest offer lives behind a <details> so the closing ask
// stays a single button.
export function CTA() {
  return (
    <div className="lp-final" id="cta">
      <h2>
        First signal in under{" "}
        <span className="lp-serif-accent">10 minutes</span>.
      </h2>
      <p className="sub-f">
        Add 2 competitors. We scrape them immediately. You get a digest sample
        the same day.
      </p>
      <a className="lp-btn-accent" href="/auth">
        Start monitoring free
      </a>
      <details className="lp-sample-fold">
        <summary>Not ready to sign up?</summary>
        <p>
          Tell us your product and two competitors. We&rsquo;ll write a real
          digest for your market, by hand. No account, no card.
        </p>
      </details>
      <p className="lp-final-micro">
        Your data stays in the EU · DPA available on request
      </p>
    </div>
  );
}
