type Faq = { q: string; a: string };

// Five questions, native <details> so the page needs no client JS here. The
// first one ships open: the anti-bot answer doubles as the ethics statement
// (we stop on refusal), which is worth showing before anyone clicks.
const FAQS: Faq[] = [
  {
    q: "How do you monitor sites with anti-bot protection?",
    a: "A browser renders most sources directly. We respect robots.txt, identify our crawler (OutrivalBot), and only collect what a site publishes openly. We never bypass a block, login, or paywall; if a site declines automated access, we stop and tell you.",
  },
  {
    q: "What qualifies a change as a signal?",
    a: "A fast AI classifier tags every diff with category, severity, and a “significant” flag. Only significant changes get a second AI pass that writes the strategic insight. Measured on production: about 1 action-grade signal for every 12 changes.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on OVHcloud in France, workers on netcup in Austria, PostgreSQL on Neon (EU region), snapshots on Cloudflare R2. Your stored data never leaves the EU.",
  },
  {
    q: "Can I track my own product too?",
    a: "Yes, on every plan. Point Outrival at your live site and pricing, and your own changes run through the same pipeline, so the digest reads your moves alongside your competitors’.",
  },
  {
    q: "How do I cancel?",
    a: "One click from your dashboard, no sales call, no penalty, no forced annual commitment. You keep access until the end of your billing cycle.",
  },
];

export function FAQ() {
  return (
    <div className="lp-faq" id="faq">
      <div>
        <h2 className="lp-light-h2">
          The questions we get <span className="lp-serif-accent">asked</span>.
        </h2>
        <p className="lp-faq-lead">
          For anything else, write to{" "}
          <a href="mailto:hello@outrival.app">hello@outrival.app</a>.
        </p>
      </div>
      <div className="lp-faq-list">
        {FAQS.map((f, i) => (
          <details key={f.q} open={i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
