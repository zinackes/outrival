import type { CSSProperties } from "react";
import { PLAN_LABELS, PLANS, type Plan } from "@outrival/shared";
import { PLAN_CARDS, planPrice } from "@/lib/plan-catalog";

// Every card used to carry a Silk fill, but at scale 0.42 and speed 1.4 the
// fold barely moved: four WebGL contexts (of the landing's fifteen, against a
// browser ceiling of sixteen) to paint what reads as a still. The fill is now
// a CSS gradient on .lp-plan, one slow fold each, angled where the shader used
// to be rotated — degrees here, the same radians as before.
const PLAN_FILL: Record<Plan, { color: string; angle: string }> = {
  free: { color: "#1a1d24", angle: "23deg" },
  starter: { color: "#16231f", angle: "86deg" },
  pro: { color: "#252143", angle: "149deg" },
  business: { color: "#2a1d23", angle: "212deg" },
};

// Dark pricing, still wired to the one plan table: copy from PLAN_CARDS,
// prices derived from PLAN_PRICING via planPrice — nothing hand-written here.
export function Pricing() {
  return (
    <div className="lp-dark-inner lp-pricing" id="pricing">
      <div className="lp-dark-head">
        <h2>
          Four plans. AI cost <span className="lp-serif-accent">included</span>.
        </h2>
        <p>
          You pay for one workspace and the number of competitors it tracks.
          No per-seat pricing, no per-scan meter: every AI cost is baked into
          the price. Each plan builds on the one before it.
        </p>
      </div>
      <div className="lp-plans">
        {PLANS.map((plan) => {
          const card = PLAN_CARDS[plan];
          return (
            <div
              key={plan}
              className={card.featured ? "lp-plan lp-plan-featured" : "lp-plan"}
              style={
                {
                  "--plan-fill": PLAN_FILL[plan].color,
                  "--plan-angle": PLAN_FILL[plan].angle,
                } as CSSProperties
              }
            >
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
