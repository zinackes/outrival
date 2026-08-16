import Link from "next/link";
import { COMPETITORS, OUTRIVAL, PRICE_AS_OF, type CompetitorKey } from "./data";

// Pricing side by side: the competitor's sales-led quote (with its dated,
// attributed third-party estimate) against Outrival's published plan ladder.
//
// Deliberately NOT two identical cards — the competitor panel reads "quote",
// the Outrival panel reads "list price" and carries the emphasis. It used to
// say that with app tokens (bg-surface, border-primary, ring), which on the
// graphite band produced two pale dashboard cards. It now wears the landing's
// own plan register: the plain card for the rival, the featured card's iris
// outline and tint for ours, so this block and the plan grid on /pricing are
// visibly the same object.
export function PricingFaceOff({
  competitorKey,
}: {
  competitorKey: CompetitorKey;
}) {
  const c = COMPETITORS[competitorKey];

  return (
    <div className="lp-faceoff">
      {/* The rival: a number nobody publishes, so the panel leads with the
          estimate and closes on where the estimate came from. */}
      <div className="lp-fo">
        <div className="fo-top">
          <h3>{c.name}</h3>
          <span className="fo-tag">Sales-led</span>
        </div>
        <div className="fo-price">
          <b>{c.pricing.estimate}</b>
        </div>
        <p className="fo-sub">{c.pricing.headline}</p>
        <p className="fo-detail">{c.pricing.detail}</p>
        <ul className="fo-list">
          <li>No public price, no self-serve signup</li>
          <li>Demo required before you see a number</li>
          <li>Annual contract</li>
        </ul>
        <p className="fo-src">
          Source: {c.pricing.source} · as of {PRICE_AS_OF}
        </p>
      </div>

      {/* Ours: the whole ladder, because the answer to "what does it cost"
          is a list of four numbers and not a range. */}
      <div className="lp-fo is-self">
        <div className="fo-top">
          <h3>Outrival</h3>
          <span className="fo-tag">Public pricing</span>
        </div>
        <div className="fo-price">
          <b>€0–199</b>
          <span>/ month</span>
        </div>
        <p className="fo-sub">Free tier, then three paid plans</p>
        <ul className="fo-plans">
          {OUTRIVAL.plans.map((p) => (
            <li key={p.name}>
              <b>{p.name}</b>
              <span className="fo-note">{p.note}</span>
              <span className="fo-amt">{p.price}/mo</span>
            </li>
          ))}
        </ul>
        <div className="fo-foot">
          <Link className="fo-cta" href="/auth">
            Start free
          </Link>
          <p className="fo-micro">
            Free forever on 2 competitors · no credit card · cancel in one click
          </p>
        </div>
      </div>
    </div>
  );
}
