"use client";

import { useState } from "react";
import { ArrowSquareOutIcon, CaretDownIcon } from "@/components/icons";
import type {
  EntitlementFact,
  JobFact,
  PlanFact,
  RoleFact,
  TierFact,
  SignalFacts as Facts,
} from "@/lib/api";
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
const FACTS_COLLAPSED = 4;
const ENTRIES_COLLAPSED = 5;

export function SignalFacts({ facts }: { facts: Facts }) {
  if (!facts) return null;
  if (facts.kind === "hiring") return <HiringFacts facts={facts} />;
  if (facts.kind === "job_facts") return <JobFacts facts={facts} />;
  if (facts.kind === "salary") return <SalaryFacts facts={facts} />;
  if (facts.kind === "content") return <ContentFacts facts={facts} />;
  return <PricingFacts facts={facts} />;
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  breaking: "Breaking",
  deprecation: "Deprecation",
  security: "Security",
  fix: "Fix",
  feature: "Feature",
  improvement: "Improvement",
};

/** The two types that carry an alert read louder than the rest of the list. */
const LOUD_ITEM_TYPES = new Set(["breaking", "deprecation"]);

/**
 * What a competitor published, named.
 *
 * A changelog signal used to read "they shipped several updates" over a feed that
 * held every entry's title, publication date and permalink. All three come from
 * the feed itself, so nothing here is a model's account of a release — the entry
 * type is the only derived field, and the loud ones are decided by keywords.
 *
 * On a cadence signal the months lead: the count is a claim about a set, so the
 * set it was counted over is printed next to it.
 */
function ContentFacts({ facts }: { facts: Extract<Facts, { kind: "content" }> }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? facts.entries : facts.entries.slice(0, ENTRIES_COLLAPSED);
  const hidden = facts.entriesTotal - shown.length;
  const { velocity } = facts;

  return (
    <div>
      {velocity ? (
        <p className="text-dense text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{velocity.count}</span>{" "}
          {velocity.count === 1 ? "entry" : "entries"} in {velocity.month} ·{" "}
          {velocity.direction === "accelerating" ? "up from" : "down from"}{" "}
          <span className="tabular-nums">{velocity.baselineAvg.toFixed(1)}</span>/month
        </p>
      ) : (
        <p className="text-dense text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{facts.entriesTotal}</span>{" "}
          {facts.entriesTotal === 1 ? "entry" : "entries"} published
        </p>
      )}

      {/* The months the average came from. Without them the baseline is a number
          the reader has to take on trust. */}
      {velocity && velocity.baseline.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {velocity.baseline.map((b) => (
            <li key={b.month} className="text-xs text-muted-foreground">
              {b.month} <span className="text-foreground tabular-nums">{b.count}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-2.5 space-y-2">
        {shown.map((e) => (
          <li key={`${e.title}-${e.publishedAt ?? ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline gap-1 rounded-sm text-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {e.title}
                  <ArrowSquareOutIcon size={14} className="shrink-0 self-center" aria-hidden />
                </a>
              ) : (
                <span className="text-sm text-foreground">{e.title}</span>
              )}
              {e.itemType && (
                <span
                  className={cn(
                    "text-xs",
                    LOUD_ITEM_TYPES.has(e.itemType)
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {ITEM_TYPE_LABEL[e.itemType] ?? e.itemType}
                </span>
              )}
              {e.publishedAt && (
                <span className="text-xs text-muted-foreground tabular-nums">{e.publishedAt}</span>
              )}
            </div>
            {/* The sentence itself, when the fact IS a sentence — a post naming the
                reader's product. Verbatim and substring-checked before storage, so
                it can be shown as a quote rather than paraphrased. */}
            {e.snippet && (
              <p className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {e.snippet}
              </p>
            )}
          </li>
        ))}
      </ul>

      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CaretDownIcon size={14} aria-hidden />
          <span className="tabular-nums">{hidden}</span> more
        </button>
      )}
    </div>
  );
}

/**
 * The salary band that moved, and the roles it was computed over.
 *
 * A median is a claim about a set, so the set is printed: the roles, each with the
 * range its own posting states, plus the trailing weeks the baseline came from.
 * Everything here is in ONE currency — the signal is per (bucket, currency) and
 * nothing is ever converted — so the two numbers on the first line can be subtracted.
 */
function SalaryFacts({ facts }: { facts: Extract<Facts, { kind: "salary" }> }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? facts.roles : facts.roles.slice(0, ROLES_COLLAPSED);
  const hidden = facts.rolesTotal - shown.length;
  const pct =
    facts.p50Before > 0
      ? Math.round(((facts.p50After - facts.p50Before) / facts.p50Before) * 100)
      : 0;

  return (
    <div>
      <p className="text-dense text-muted-foreground">
        {facts.bucketLabel}{" "}
        <span className="text-foreground">({facts.currency})</span> median{" "}
        <span className="tabular-nums">{facts.p50Before.toLocaleString("en-US")}</span> →{" "}
        <span className="font-medium text-foreground tabular-nums">
          {facts.p50After.toLocaleString("en-US")}
        </span>{" "}
        <span className="tabular-nums">
          ({pct > 0 ? "+" : ""}
          {pct}%
        </span>
        , over <span className="tabular-nums">{facts.n}</span>{" "}
        {facts.n === 1 ? "role" : "roles"})
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {shown.map((r, i) => (
          <li key={`${r.title}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-baseline gap-1 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {r.title}
                <ArrowSquareOutIcon size={14} className="shrink-0 self-center" aria-hidden />
              </a>
            ) : (
              <span>{r.title}</span>
            )}
            {r.location && <span className="text-xs text-muted-foreground">{r.location}</span>}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {salaryLabel({ ...r, salaryCurrency: facts.currency })}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CaretDownIcon size={14} aria-hidden />
          <span className="tabular-nums">{hidden}</span> more
        </button>
      )}

      {facts.trailing.length > 0 && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          Compared against{" "}
          {facts.trailing
            .map((t) => `${t.weekStart} ${t.p50.toLocaleString("en-US")} (n=${t.n})`)
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}

const JOB_FACT_LABEL: Record<string, string> = {
  tech: "Technology",
  product_hint: "Unannounced",
  team_size: "Team size",
  market: "Market",
  language: "Language",
};

/**
 * Facts a competitor stated in its own job descriptions.
 *
 * The quoted sentence IS the evidence: every snippet was verified as a substring
 * of the description before it was stored, so what is printed here is what they
 * wrote, and the posting is one click away for anyone who wants the paragraph
 * around it. Grouped by value, because a technology cited in four roles is one
 * fact with four sources, not four facts.
 */
function JobFacts({ facts }: { facts: Extract<Facts, { kind: "job_facts" }> }) {
  const [expanded, setExpanded] = useState(false);

  const groups = new Map<string, { kind: string; value: string; items: JobFact[] }>();
  for (const f of facts.facts) {
    const key = `${f.kind}::${f.value.toLowerCase()}`;
    const g = groups.get(key) ?? { kind: f.kind, value: f.value, items: [] };
    g.items.push(f);
    groups.set(key, g);
  }
  const all = Array.from(groups.values());
  const shown = expanded ? all : all.slice(0, FACTS_COLLAPSED);

  return (
    <div>
      <p className="text-dense text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{all.length}</span>{" "}
        {all.length === 1 ? "fact" : "facts"} stated in their job descriptions
      </p>

      <ul className="mt-2.5 space-y-2.5">
        {shown.map((g) => (
          <li key={`${g.kind}-${g.value}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm text-foreground">{g.value}</span>
              <span className="text-xs text-muted-foreground">
                {JOB_FACT_LABEL[g.kind] ?? g.kind}
              </span>
              {g.items.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  <span className="tabular-nums">{g.items.length}</span> postings
                </span>
              )}
            </div>
            {/* The words they used. Quoting one source per fact keeps the block
                readable; the rest are named by the posting count above. */}
            <blockquote className="mt-1 border-l-2 border-border pl-2.5 text-sm text-muted-foreground">
              “{g.items[0]!.evidenceSnippet}”
            </blockquote>
            <p className="mt-1 text-xs text-muted-foreground">
              {g.items[0]!.postingUrl ? (
                <a
                  href={g.items[0]!.postingUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline gap-1 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {g.items[0]!.postingTitle}
                  <ArrowSquareOutIcon size={14} className="shrink-0 self-center" aria-hidden />
                </a>
              ) : (
                g.items[0]!.postingTitle
              )}
            </p>
          </li>
        ))}
      </ul>

      {all.length > FACTS_COLLAPSED && (
        <Toggle
          open={expanded}
          onClick={() => setExpanded((v) => !v)}
          closedLabel={`Show ${all.length - FACTS_COLLAPSED} more`}
          openLabel="Show fewer"
        />
      )}
    </div>
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
  const { plans, trial, entitlements, tiers } = facts;
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

      {(entitlements ?? []).length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="text-dense text-muted-foreground">
            Packaging{" · "}
            <span className="tabular-nums">{entitlements.length}</span> feature
            {entitlements.length === 1 ? "" : "s"} moved
          </p>
          <ul className="mt-1.5 space-y-1">
            {entitlements.map((e, i) => (
              <li key={`${e.featureLabel}-${i}`}>
                <Entitlement fact={e} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {(tiers ?? []).length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="text-dense text-muted-foreground">
            Volume bands{" · "}
            <span className="tabular-nums">{tiers.length}</span> move
            {tiers.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1.5 space-y-1">
            {tiers.map((t, i) => (
              <li key={`${t.planName}-${i}`}>
                <Tier fact={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// The bands carry their own plan prefix (the signal's human_change strings are
// exact), so the block drops it rather than printing the plan name twice.
const bandOf = (phrase: string | null): string | null =>
  phrase ? (phrase.split(" — ")[1] ?? phrase) : null;

const TIER_STATE_LABEL: Record<TierFact["state"], string> = {
  boundary_moved: "Band moved",
  rate_changed: "Rate changed",
};

function Tier({ fact }: { fact: TierFact }) {
  const before = bandOf(fact.before);
  const after = bandOf(fact.after);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-foreground">{fact.planName}</span>
      <span className="text-xs text-muted-foreground">{TIER_STATE_LABEL[fact.state]}</span>
      <span className="ml-auto flex items-baseline gap-1.5 tabular-nums">
        {before && <span className="text-muted-foreground line-through">{before}</span>}
        {before && after && <span className="text-muted-foreground">→</span>}
        {after && <span className="text-foreground">{after}</span>}
      </span>
    </div>
  );
}

// Same neutrality rule as prices: a feature reaching a cheaper plan is their
// move, not our win — the strings state it, no tint asserts a judgement.
const ENTITLEMENT_STATE_LABEL: Record<EntitlementFact["state"], string> = {
  moved: "Moved",
  limit_changed: "Limit changed",
  added: "New",
  removed: "Removed",
};

function Entitlement({ fact }: { fact: EntitlementFact }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-foreground">{fact.featureLabel}</span>
      <span className="text-xs text-muted-foreground">
        {ENTITLEMENT_STATE_LABEL[fact.state]}
      </span>
      <span className="ml-auto flex items-baseline gap-1.5 tabular-nums">
        {fact.before && (
          <span
            className={cn(
              "text-muted-foreground",
              (fact.state === "limit_changed" || fact.state === "removed") && "line-through",
            )}
          >
            {fact.before}
          </span>
        )}
        {fact.before && fact.after && <span className="text-muted-foreground">→</span>}
        {fact.after && <span className="text-foreground">{fact.after}</span>}
      </span>
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
