import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      className="border-y border-border bg-background-2 py-20 sm:py-28"
      id="pricing"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Four plans.
            <br />
            AI cost included.
          </h2>
          <p className="text-text-muted leading-relaxed">
            You pay by user and by number of competitors. Claude + Groq API
            calls are baked into the price — no usage-based billing.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-xl border bg-surface p-6 ${
                p.featured
                  ? "border-primary/60 ring-1 ring-primary/30"
                  : "border-border"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 font-mono text-meta font-semibold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              )}
              <div>
                <div
                  className={`font-mono text-xs uppercase tracking-wider ${
                    p.featured ? "text-primary" : "text-text-subtle"
                  }`}
                >
                  {p.tag}
                </div>
                <div className="mt-1.5 text-lg font-semibold">{p.name}</div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold">{p.price}</span>
                <span className="text-sm text-text-subtle">{p.suffix}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-text-muted">
                {p.desc}
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check
                      size={14}
                      className="mt-0.5 shrink-0 text-primary"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={p.featured ? "default" : "outline"}
                className="mt-6 w-full"
              >
                <a href="#cta">{p.cta}</a>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
