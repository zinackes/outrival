"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { CaretDownIcon } from "@/components/icons";
import { bandPhrase, meterUnitLabel, type TierBandRow } from "@outrival/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabSection } from "@/components/outrival/tab-shell";

/**
 * How the metered plans of the latest capture actually charge (Pricing
 * Intelligence P3): the published volume ladder, the monthly minimum, and the
 * percentage half of a "2.9% + $0.30".
 *
 * A price list names the tiers; none of this is in it. A plan whose ladder
 * shrinks its first band gets dearer without a single printed number moving, so
 * the bands have to be readable next to the prices rather than only inside a
 * signal.
 *
 * Renders nothing when nothing metered was captured: an empty ladder under a
 * heading would read as "they charge a flat rate", which is not what absence
 * means.
 */
export function RateStructures({ competitorId }: { competitorId: string }) {
  const q = useQuery({
    queryKey: ["competitor", competitorId, "rate-structures"],
    queryFn: () => api.getCompetitorRateStructures(competitorId),
    placeholderData: keepPreviousData,
  });

  const data = q.data ?? null;
  const points = data?.points ?? [];
  if (!data || (data.plans.length === 0 && data.tiers.length === 0 && points.length === 0)) {
    return null;
  }

  // A plan the ladder covers but the rate rows missed still deserves a row: the
  // bands ARE its rate structure.
  const names = [...new Set([...data.plans.map((p) => p.planName), ...data.tiers.map((t) => t.planName)])];

  return (
    <TabSection title="Rate structure">
      <ul className="flex flex-col">
        {names.map((name) => (
          <PlanRates
            key={name}
            name={name}
            plan={data.plans.find((p) => p.planName === name) ?? null}
            tiers={data.tiers.filter((t) => t.planName === name)}
          />
        ))}
      </ul>
      {points.length > 0 && <CostAtVolume competitorId={competitorId} points={points} />}
    </TabSection>
  );
}

type CostPoint = {
  planName: string;
  meterUnit: string;
  referenceQty: number;
  cost: number;
  currency: string;
  method: string;
  capturedAt: string;
  hasEvidence: boolean;
  evidenceKind: "screenshot" | "api_response" | null;
};

/**
 * What each meter COSTS at the reference volumes — the line a rate card can't
 * give you, because "$0.002 per request" is not a number anyone budgets with.
 *
 * Each row says where its figure came from. `calculator_probe` was MEASURED on
 * the competitor's own calculator and links the screenshot taken while it was on
 * screen; everything else is arithmetic over the ladder printed above. Naming
 * which is which is the point: one is evidence, the other is a derivation, and a
 * reader deciding on price is entitled to know which one they are reading.
 */
function CostAtVolume({
  competitorId,
  points,
}: {
  competitorId: string;
  points: CostPoint[];
}) {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <h4 className="text-dense text-muted-foreground">Cost at volume</h4>
      <ul className="flex flex-col">
        {points.map((p) => {
          const measured = p.method === "calculator_probe";
          return (
            <li
              key={`${p.meterUnit}-${p.referenceQty}`}
              className="flex flex-wrap items-baseline gap-x-2 border-b border-border py-2 last:border-b-0"
            >
              <span className="text-sm tabular-nums text-foreground">
                {p.referenceQty.toLocaleString("en-US")}{" "}
                {meterUnitLabel(p.meterUnit, p.referenceQty)}/mo
              </span>
              <span className="text-sm tabular-nums text-foreground">
                {formatMoney(p.cost, p.currency)}
              </span>
              <span
                className="text-xs text-muted-foreground"
                title={
                  measured
                    ? `Measured on ${p.planName} on their own pricing calculator on ${formatDay(p.capturedAt)}` +
                      (p.evidenceKind === "api_response"
                        ? " — read from the pricing response their page requests, confirmed against the figure the calculator displayed"
                        : "")
                    : `Computed from the volume bands they publish, captured ${formatDay(p.capturedAt)}`
                }
              >
                {measured
                  ? `measured on their calculator ${formatDay(p.capturedAt)}`
                  : "computed from published tiers"}
              </span>
              {measured && p.hasEvidence && (
                <a
                  href={api.calculatorEvidenceUrl(competitorId, p.meterUnit, p.referenceQty)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link ml-auto text-xs underline-offset-2 hover:underline"
                >
                  {p.evidenceKind === "api_response" ? "Response" : "Screenshot"}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type PlanRow = {
  planName: string;
  unit: string | null;
  currency: string | null;
  rateStructure: string | null;
  minimumAmount: number | null;
  percentageRate: number | null;
};

type TierRow = {
  planName: string;
  unit: string | null;
  fromQty: number;
  toQty: number | null;
  unitPrice: number | null;
  flatFee: number | null;
};

const STRUCTURE_LABEL: Record<string, string> = {
  standard: "Flat rate",
  graduated: "Graduated bands",
  volume: "Volume bands",
  package: "Priced in blocks",
  percentage: "Percentage of value",
};

function PlanRates({
  name,
  plan,
  tiers,
}: {
  name: string;
  plan: PlanRow | null;
  tiers: TierRow[];
}) {
  const [open, setOpen] = useState(false);
  const currency = plan?.currency ?? null;
  const unit = plan?.unit ?? tiers[0]?.unit ?? null;

  const facts = [
    plan?.rateStructure ? (STRUCTURE_LABEL[plan.rateStructure] ?? plan.rateStructure) : null,
    unit ? `per ${meterUnitLabel(unit)}` : null,
    plan?.percentageRate != null ? `${plan.percentageRate}% of value` : null,
    plan?.minimumAmount != null
      ? `${formatMoney(plan.minimumAmount, currency)}/mo minimum`
      : null,
  ].filter(Boolean);

  return (
    <li className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm text-foreground">{name}</span>
        {facts.length > 0 && (
          <span className="text-xs text-muted-foreground">{facts.join(" · ")}</span>
        )}
        {tiers.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-link ml-auto flex items-center gap-1 rounded-sm text-xs underline-offset-2 hover:underline"
          >
            <span className="tabular-nums">{tiers.length}</span> band
            {tiers.length === 1 ? "" : "s"}
            <CaretDownIcon
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
        )}
      </div>

      {open && tiers.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 pl-3">
          {tiers.map((t, i) => (
            <li key={`${t.fromQty}-${i}`} className="text-sm tabular-nums text-muted-foreground">
              {bandPhrase(toBand(t), currency)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The stored row in the shape the shared band formatter reads, so the ladder
 * prints here exactly as it prints inside a signal. */
function toBand(t: TierRow): TierBandRow {
  return {
    plan_name: t.planName,
    unit: t.unit,
    from_qty: t.fromQty,
    to_qty: t.toQty,
    unit_price: t.unitPrice,
    flat_fee: t.flatFee,
  };
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return String(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
