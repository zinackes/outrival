"use client";

import { useState } from "react";
import { ArrowSquareOutIcon, CaretDownIcon } from "@/components/icons";
import type { PlanFact, RoleFact, SignalFacts as Facts } from "@/lib/api";
import { cn } from "@/lib/utils";
import { salaryLabel } from "@/lib/format-money";
import { fmtPrice, PERIOD_SHORT } from "@/components/dashboard/activity/format";

/**
 * The structured facts behind a signal: which roles opened, which plan moved.
 *
 * The signal's prose is written from a text diff of the page, so it says a
 * competitor "added roles in UX design, engineering and revenue operations" and
 * names none of them. The extractor for that same capture wrote every title, its
 * location, its seniority and its apply link into job_postings, and the pricing
 * one wrote every plan and its price. Both were readable on the competitor's tabs
 * and nowhere near the signal that was about them.
 *
 * A board can open fifty roles at once, so the list shows a handful and says how
 * many are behind the fold. What moved always leads.
 */

const ROLES_COLLAPSED = 6;
const PLANS_COLLAPSED = 6;

export function SignalFacts({ facts }: { facts: Facts }) {
  if (!facts) return null;
  return facts.kind === "hiring" ? (
    <HiringFacts facts={facts} />
  ) : (
    <PricingFacts facts={facts} />
  );
}

function HiringFacts({ facts }: { facts: Extract<Facts, { kind: "hiring" }> }) {
  const [expanded, setExpanded] = useState(false);
  const { opened, closed, openedTotal, closedTotal, openNow } = facts;

  // Opened roles are the news; closures only get their own block when there is
  // nothing opened to lead with, since a board that swaps a role reads as churn.
  const lead = opened.length > 0 ? opened : closed;
  const leadIsOpened = opened.length > 0;
  const leadTotal = leadIsOpened ? openedTotal : closedTotal;
  const shown = expanded ? lead : lead.slice(0, ROLES_COLLAPSED);

  return (
    <div>
      <p className="text-dense text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{leadTotal}</span>{" "}
        {leadIsOpened ? "role" : "role"}
        {leadTotal === 1 ? "" : "s"} {leadIsOpened ? "opened" : "closed"}
        {openNow > 0 && (
          <>
            {" · "}
            <span className="tabular-nums">{openNow}</span> open now
          </>
        )}
        {leadIsOpened && closedTotal > 0 && (
          <>
            {" · "}
            <span className="tabular-nums">{closedTotal}</span> closed
          </>
        )}
      </p>

      <ul className="mt-2.5 space-y-2">
        {shown.map((role, i) => (
          <li key={`${role.title}-${i}`}>
            <Role role={role} struck={!leadIsOpened} />
          </li>
        ))}
      </ul>

      {lead.length > ROLES_COLLAPSED && (
        <Toggle
          open={expanded}
          onClick={() => setExpanded((v) => !v)}
          closedLabel={`Show ${lead.length - ROLES_COLLAPSED} more`}
          openLabel="Show fewer"
        />
      )}
    </div>
  );
}

function Role({ role, struck }: { role: RoleFact; struck: boolean }) {
  const salary = salaryLabel(role);
  // Seniority and department are noise next to a title that already states them
  // ("Senior Engineer, Platform"), so each is dropped when the title says it.
  const title = role.title.toLowerCase();
  const meta = [
    role.seniority && !title.includes(role.seniority.toLowerCase()) ? role.seniority : null,
    role.department && !title.includes(role.department.toLowerCase()) ? role.department : null,
    role.location,
    salary,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {role.url ? (
        <a
          href={role.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-1 rounded-sm text-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {role.title}
          <ArrowSquareOutIcon size={14} className="shrink-0 self-center" aria-hidden />
        </a>
      ) : (
        <span className={cn("text-sm text-foreground", struck && "line-through")}>
          {role.title}
        </span>
      )}
      {meta.length > 0 && (
        <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span>
      )}
    </div>
  );
}

function PricingFacts({ facts }: { facts: Extract<Facts, { kind: "pricing" }> }) {
  const [expanded, setExpanded] = useState(false);
  const { plans, trial } = facts;
  const moved = plans.filter((p) => p.state !== "unchanged").length;
  const shown = expanded ? plans : plans.slice(0, PLANS_COLLAPSED);

  return (
    <div>
      <p className="text-dense text-muted-foreground">
        {moved > 0 ? (
          <>
            <span className="font-medium text-foreground tabular-nums">{moved}</span> plan
            {moved === 1 ? "" : "s"} moved
            {" · "}
            <span className="tabular-nums">{plans.length}</span> on the page
          </>
        ) : (
          <>
            <span className="font-medium text-foreground tabular-nums">{plans.length}</span>{" "}
            plan{plans.length === 1 ? "" : "s"} captured
          </>
        )}
        {trial?.hasTrial && (
          <>
            {" · "}
            {trial.days ? `${trial.days}-day free trial` : "Free trial"}
            {trial.requiresCard === true && ", card required"}
            {trial.requiresCard === false && ", no card"}
          </>
        )}
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {shown.map((plan, i) => (
          <li key={`${plan.planName}-${plan.billingPeriod}-${i}`}>
            <Plan plan={plan} />
          </li>
        ))}
      </ul>

      {plans.length > PLANS_COLLAPSED && (
        <Toggle
          open={expanded}
          onClick={() => setExpanded((v) => !v)}
          closedLabel={`Show ${plans.length - PLANS_COLLAPSED} more`}
          openLabel="Show fewer"
        />
      )}
    </div>
  );
}

// Deliberately uncoloured: a competitor cutting a price is good for them and bad
// for us, so tinting the direction would assert a judgement the number does not
// carry. Same rule the change ledger follows.
const STATE_LABEL: Record<PlanFact["state"], string | null> = {
  added: "New",
  removed: "Removed",
  changed: null,
  unchanged: null,
};

function Plan({ plan }: { plan: PlanFact }) {
  const period = PERIOD_SHORT[plan.billingPeriod];
  const price =
    plan.price === null
      ? plan.state === "removed"
        ? null
        : "Custom"
      : `${fmtPrice(plan.price, plan.currency)}${period ? `/${period}` : ""}`;
  const before =
    plan.previousPrice !== null && plan.previousPrice !== plan.price
      ? `${fmtPrice(plan.previousPrice, plan.currency)}${period ? `/${period}` : ""}`
      : null;
  const label = STATE_LABEL[plan.state];

  // The bundle line, only when the included quantity actually moved: the exact
  // before/after ("10,000 → 5,000 API calls included") is the fact of a
  // shrinkflation signal — the headline price above it did not change.
  const quantityMoved =
    plan.includedQuantity !== null &&
    plan.previousIncludedQuantity !== null &&
    plan.includedQuantity !== plan.previousIncludedQuantity;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "text-sm text-foreground",
            plan.state === "removed" && "line-through text-muted-foreground",
          )}
        >
          {plan.planName}
        </span>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
        <span className="ml-auto flex items-baseline gap-1.5 text-sm tabular-nums">
          {before && (
            <span className="text-muted-foreground line-through">{before}</span>
          )}
          {price && <span className="text-foreground">{price}</span>}
        </span>
      </div>
      {quantityMoved && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums line-through">
            {plan.previousIncludedQuantity!.toLocaleString("en-US")}
          </span>{" "}
          →{" "}
          <span className="tabular-nums text-foreground">
            {plan.includedQuantity!.toLocaleString("en-US")}
          </span>{" "}
          {plan.unit ?? "units"} included
          {plan.price === plan.previousPrice && ", price unchanged"}
        </p>
      )}
    </div>
  );
}

function Toggle({
  open,
  onClick,
  closedLabel,
  openLabel,
}: {
  open: boolean;
  onClick: () => void;
  closedLabel: string;
  openLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="mt-2 flex items-center gap-1.5 rounded-sm text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {open ? openLabel : closedLabel}
      <CaretDownIcon
        className={cn("size-3.5 transition-transform", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}
