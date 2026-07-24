import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type Plan = {
  tag: string;
  name: string;
  price: string;
  suffix: string;
  desc: string;
  cta: string;
  href: string;
  featured: boolean;
  includes?: string;
  features: string[];
  note?: { label: string; href: string };
};

const PLANS: Plan[] = [
  {
    tag: "Free",
    name: "Free",
    price: "0",
    suffix: "€ / month",
    desc: "Validate the tool on 2 competitors before bringing in your team.",
    cta: "Start free",
    href: "/auth",
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
    cta: "Get started",
    href: "/auth",
    featured: false,
    includes: "Everything in Free, plus:",
    features: [
      "5 competitors",
      "Daily scans · Slack & email digests",
      "Adds jobs + status page",
    ],
  },
  {
    tag: "Pro",
    name: "Pro",
    price: "79",
    suffix: "€ / month",
    desc: "For product, growth, or strategy teams that need the full signal stream.",
    cta: "Get started",
    href: "/auth",
    featured: true,
    includes: "Everything in Starter, plus:",
    features: [
      "15 competitors",
      "Real-time Slack/email alerts",
      // Shipped and gated here (PLAN_LIMITS.allowedChannels), but it was listed
      // nowhere a buyer looks. The public API is NOT on this page: features.api
      // is false on every plan and /docs says there are no endpoints or keys
      // today — selling it would break one click away.
      "Outbound webhooks",
      "AI-generated battle cards",
      "Trustpilot & App Store reviews",
    ],
  },
  {
    tag: "Business",
    name: "Business",
    price: "199",
    suffix: "€ / month",
    desc: "50 competitors, the highest usage limits, and priority support.",
    cta: "Start Business",
    href: "/auth",
    featured: false,
    includes: "Everything in Pro, plus:",
    features: [
      "50 competitors",
      "Higher re-scan & discovery limits",
      "Priority monitoring cadence",
      "DPA · security review",
    ],
    note: {
      label: "Need SSO or a custom DPA? Contact us",
      href: "mailto:hello@outrival.app",
    },
  },
];

export function Pricing() {
  return (
    <section
      className="border-y border-border bg-background-2 py-16 sm:py-24"
      id="pricing"
      data-reveal
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Four plans.
            <br />
            AI cost included.
          </h2>
          <p className="text-text-muted leading-relaxed">
            You pay by user and by number of competitors. Every AI cost is baked
            into the price, with no usage-based billing. Each plan builds on the one
            before it.
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
                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-meta font-semibold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              )}
              <div>
                <div
                  className={`text-xs uppercase tracking-wider ${
                    p.featured ? "text-primary" : "text-text-subtle"
                  }`}
                >
                  {p.tag}
                </div>
                <div className="mt-1.5 text-lg font-semibold">{p.name}</div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tabular-nums">
                  {p.price}
                </span>
                <span className="text-sm text-text-subtle">{p.suffix}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-text-muted">
                {p.desc}
              </p>
              {p.includes && (
                <p className="mt-5 text-xs font-medium text-text-subtle">
                  {p.includes}
                </p>
              )}
              <ul
                className={`flex-1 space-y-2.5 text-sm ${p.includes ? "mt-2.5" : "mt-5"}`}
              >
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={p.featured ? "default" : "outline"}
                className="mt-6 w-full"
              >
                <Link href={p.href}>{p.cta}</Link>
              </Button>
              {p.note && (
                <a
                  href={p.note.href}
                  className="mt-3 block text-center text-xs text-text-subtle underline-offset-2 hover:text-foreground hover:underline"
                >
                  {p.note.label}
                </a>
              )}
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-dense text-text-subtle">
          Free forever on 2 competitors · no credit card · cancel in one click.
        </p>
      </div>
    </section>
  );
}
