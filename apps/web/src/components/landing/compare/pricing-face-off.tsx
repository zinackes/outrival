import Link from "next/link";
import { CheckIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { COMPETITORS, OUTRIVAL, PRICE_AS_OF, type CompetitorKey } from "./data";

// Pricing side by side: the competitor's sales-led quote (with its dated,
// attributed third-party estimate) against Outrival's published plan ladder.
// Deliberately NOT two identical cards — the competitor panel reads "quote",
// the Outrival panel reads "list price" and carries the primary emphasis.
export function PricingFaceOff({
  competitorKey,
}: {
  competitorKey: CompetitorKey;
}) {
  const c = COMPETITORS[competitorKey];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Competitor — quote-based */}
      <div className="flex flex-col rounded-xl border border-border bg-surface p-6 sm:p-7">
        <div className="flex items-baseline justify-between">
          <div className="text-lg font-semibold">{c.name}</div>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-meta font-medium text-text-subtle">
            Sales-led
          </span>
        </div>
        <div className="mt-5 text-3xl font-semibold tabular-nums">
          {c.pricing.estimate}
        </div>
        <div className="mt-1 text-dense text-text-subtle">
          {c.pricing.headline}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-text-muted">
          {c.pricing.detail}
        </p>
        <ul className="mt-5 space-y-2 text-sm text-text-muted">
          <li className="flex items-start gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-text-subtle" />
            No public price, no self-serve signup
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-text-subtle" />
            Demo required before you see a number
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-text-subtle" />
            Annual contract
          </li>
        </ul>
        <div className="mt-auto pt-6 text-meta text-text-subtle">
          Source: {c.pricing.source} · as of {PRICE_AS_OF}
        </div>
      </div>

      {/* Outrival — public list price */}
      <div className="flex flex-col rounded-xl border border-primary/60 bg-surface p-6 ring-1 ring-primary/30 sm:p-7">
        <div className="flex items-baseline justify-between">
          <div className="text-lg font-semibold">Outrival</div>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-meta font-medium text-primary">
            Public pricing
          </span>
        </div>
        <div className="mt-5 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums">€0–199</span>
          <span className="text-sm text-text-subtle">/ month</span>
        </div>
        <div className="mt-1 text-dense text-text-subtle">
          Free tier, then three paid plans
        </div>
        <ul className="mt-5 space-y-2.5 text-sm">
          {OUTRIVAL.plans.map((p) => (
            <li key={p.name} className="flex items-start gap-2.5">
              <CheckIcon size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium">{p.name}</span>{" "}
                <span className="tabular-nums text-text-muted">
                  {p.price}/mo
                </span>{" "}
                <span className="text-text-subtle">· {p.note}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Button asChild className="w-full">
            <Link href="/auth">Start free</Link>
          </Button>
          <p className="mt-3 text-center text-meta text-text-subtle">
            Free forever on 2 competitors · no credit card · cancel in one click
          </p>
        </div>
      </div>
    </div>
  );
}
