import { Check } from "lucide-react";

type Plan = {
  tag: string;
  name: string;
  price: string;
  suffix: string;
  desc: string;
  cta: string;
  featured: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    tag: "Free",
    name: "Free",
    price: "0",
    suffix: "€ / month",
    desc: "Validate the tool on 2 competitors before bringing in your team.",
    cta: "Start free",
    featured: false,
    features: [
      "2 competitors",
      "Weekly email digest",
      "Homepage · pricing · blog",
      "1 user",
    ],
  },
  {
    tag: "Starter",
    name: "Starter",
    price: "29",
    suffix: "€ / month",
    desc: "For solo operators who need daily scans and Slack delivery.",
    cta: "Try Starter · 14 days",
    featured: false,
    features: [
      "5 competitors",
      "Daily scans · Slack & email digests",
      "Adds the jobs source",
      "1 user",
    ],
  },
  {
    tag: "Pro",
    name: "Pro",
    price: "79",
    suffix: "€ / month",
    desc: "For product, growth, or strategy teams that need the full signal stream.",
    cta: "Try Pro · 14 days",
    featured: true,
    features: [
      "15 competitors",
      "All categories + severities",
      "Real-time Slack/email alerts",
      "AI-generated battle cards",
      "G2 & Capterra reviews",
    ],
  },
  {
    tag: "Business",
    name: "Business",
    price: "199",
    suffix: "€ / month",
    desc: "Unlimited competitors, App Store reviews, multi-user, API access.",
    cta: "Talk to the team",
    featured: false,
    features: [
      "Unlimited competitors",
      "Multi-user · API access",
      "App Store + Play Store reviews",
      "Custom sources (intranet, internal APIs)",
      "SSO SAML · audit logs · DPA",
    ],
  },
];

export function Pricing() {
  return (
    <section
      className="section"
      id="pricing"
      style={{
        background: "var(--background-2)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="wrap">
        <div className="head-C">
          <h2>
            Four plans.
            <br />
            AI cost included.
          </h2>
          <p className="lede">
            You pay by user and by number of competitors. Claude + Groq API
            calls are baked into the price — no usage-based billing.
          </p>
        </div>
        <div className="pricing">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={"plan " + (p.featured ? "featured" : "")}
            >
              <div>
                <div className="plan-tag">{p.tag}</div>
                <div className="plan-name" style={{ marginTop: 6 }}>
                  {p.name}
                </div>
              </div>
              <div className="plan-price">
                <span
                  className="plan-price-num"
                  style={p.price.length > 4 ? { fontSize: 28 } : {}}
                >
                  {p.price}
                </span>
                {p.suffix && (
                  <span className="plan-price-suffix">{p.suffix}</span>
                )}
              </div>
              <p className="plan-desc">{p.desc}</p>
              <ul className="plan-list">
                {p.features.map((f, i) => (
                  <li key={i}>
                    <Check size={14} /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#cta"
                className={"btn " + (p.featured ? "btn-primary" : "btn-ghost")}
                style={{ justifyContent: "center", marginTop: "auto" }}
              >
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
