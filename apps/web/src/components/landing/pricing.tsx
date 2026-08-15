import { PLAN_LABELS, PLANS } from "@outrival/shared";
import { PLAN_CARDS, planPrice } from "@/lib/plan-catalog";
import { SilkFill } from "./silk-fill";

// Dark pricing, still wired to the one plan table: copy from PLAN_CARDS,
// prices derived from PLAN_PRICING via planPrice — nothing hand-written here.
// Only the featured plan gets a Silk fill; the other cards stay quiet.
export function Pricing() {
  return (
    <div className="lp-dark-inner lp-pricing" id="pricing">
      <div className="lp-dark-head">
        <h2>
          Four plans. AI cost <span className="lp-serif-accent">included</span>.
        </h2>
        <p>
          You pay by user and by number of competitors. Every AI cost is baked
          into the price, with no usage-based billing. Each plan builds on the
          one before it.
        </p>
      </div>
      <div className="lp-plans">
        {PLANS.map((plan) => {
          const card = PLAN_CARDS[plan];
          return (
            <div
              key={plan}
              className={card.featured ? "lp-plan lp-plan-featured" : "lp-plan"}
            >
              {card.featured && <SilkFill color="#2d2b3f" />}
              {card.featured && <span className="plan-pop">Most popular</span>}
              <h3>{PLAN_LABELS[plan]}</h3>
              <div className="plan-price">
                <b>{planPrice(plan, "monthly").perMonth}</b>
                <span>€ / month</span>
              </div>
              <p className="plan-desc">{card.desc}</p>
              {card.includes && <p className="plan-inc">{card.includes}</p>}
              <ul>
                {card.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a className="plan-cta" href="/auth">
                {card.cta}
              </a>
              {card.note && (
                <p className="plan-note">
                  <a href={card.note.href}>{card.note.label}</a>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="lp-plans-foot">
        Free forever on 2 competitors · no credit card · cancel in one click.
      </p>
    </div>
  );
}
