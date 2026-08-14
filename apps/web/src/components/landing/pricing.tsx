import Link from "next/link";
import { PLAN_LABELS, PLANS } from "@outrival/shared";
import { CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PLAN_CARDS, planPrice } from "@/lib/plan-catalog";

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
          {PLANS.map((plan) => {
            const card = PLAN_CARDS[plan];
            const name = PLAN_LABELS[plan];
            return (
              <div
                key={plan}
                className={`relative flex flex-col rounded-xl border bg-surface p-6 ${
                  card.featured
                    ? "border-primary/60 ring-1 ring-primary/30"
                    : "border-border"
                }`}
              >
                {card.featured && (
                  <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-meta font-semibold uppercase tracking-wider text-primary-foreground">
                    Most popular
                  </span>
                )}
                <div>
                  <div
                    className={`text-xs uppercase tracking-wider ${
                      card.featured ? "text-primary" : "text-text-subtle"
                    }`}
                  >
                    {name}
                  </div>
                  <div className="mt-1.5 text-lg font-semibold">{name}</div>
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tabular-nums">
                    {planPrice(plan, "monthly").perMonth}
                  </span>
                  <span className="text-sm text-text-subtle">€ / month</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">
                  {card.desc}
                </p>
                {card.includes && (
                  <p className="mt-5 text-xs font-medium text-text-subtle">
                    {card.includes}
                  </p>
                )}
                <ul
                  className={`flex-1 space-y-2.5 text-sm ${card.includes ? "mt-2.5" : "mt-5"}`}
                >
                  {card.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckIcon size={16} className="mt-0.5 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={card.featured ? "default" : "outline"}
                  className="mt-6 w-full"
                >
                  <Link href="/auth">{card.cta}</Link>
                </Button>
                {card.note && (
                  <a
                    href={card.note.href}
                    className="mt-3 block text-center text-xs text-text-subtle underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {card.note.label}
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-dense text-text-subtle">
          Free forever on 2 competitors · no credit card · cancel in one click.
        </p>
      </div>
    </section>
  );
}
