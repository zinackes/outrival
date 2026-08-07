"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowUpRightIcon } from "@/components/icons";
import { PLAN_LABELS, PLAN_LIMITS } from "@outrival/shared";
import {
  type UsageItem,
  type UsageDimension,
} from "@/lib/api";
import { usageQuery } from "@/lib/queries";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SettingsPageHead,
  SettingsSection,
} from "@/components/dashboard/settings-page";
import { SettingMetersSkeleton } from "@/components/dashboard/skeletons";
import { SettingsError } from "@/components/outrival/list-error";

const DIMENSION_LABEL: Record<UsageDimension, string> = {
  competitors: "Competitors",
  products: "Products",
  battleCardsPerDay: "Battle cards",
  discoveriesPerMonth: "Discoveries",
  forcedRescansPerDay: "Forced re-scans",
  aiActionsPerHour: "AI actions",
};

// What each metered dimension actually charges for, so a refused click is explainable
// before it happens. Only the ones whose scope isn't obvious from the label.
const DIMENSION_HINT: Partial<Record<UsageDimension, string>> = {
  aiActionsPerHour:
    "Battle cards, Ask questions, discovery and repeat re-scans. Enabling a source for the first time is free.",
};

const PERIOD_LABEL: Record<UsageItem["period"], string> = {
  current: "active",
  day: "today",
  month: "this month",
  hour: "this hour",
};

// When the window rolls over. "this hour" names the window but not the moment,
// so a user sitting at the cap could not tell when to try again.
const PERIOD_RESET: Partial<Record<UsageItem["period"], string>> = {
  day: "resets at midnight UTC",
  month: "resets on the 1st",
  hour: "resets at the top of the hour",
};

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  daily: "Daily",
  daily_adaptive: "Daily (adaptive)",
  daily_priority: "Daily (priority)",
};

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function UsageRow({ item }: { item: UsageItem }) {
  const atLimit = item.used >= item.limit;
  const reset = PERIOD_RESET[item.period];
  return (
    <div className="py-3.5 border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-dense font-medium">{DIMENSION_LABEL[item.dimension]}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          <span className={atLimit ? "text-critical" : "text-foreground"}>{item.used}</span>
          {" / "}
          {item.limit}
          <span className="text-muted-foreground">
            {" · "}
            {PERIOD_LABEL[item.period]}
            {reset ? ` · ${reset}` : ""}
          </span>
        </span>
      </div>
      <Progress
        value={pct(item.used, item.limit)}
        className={`mt-2 h-1.5 ${atLimit ? "[&>*]:bg-critical" : ""}`}
      />
      {DIMENSION_HINT[item.dimension] && (
        <p className="mt-1.5 text-xs text-muted-foreground">{DIMENSION_HINT[item.dimension]}</p>
      )}
      {atLimit && (
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-critical">Limit reached.</span>
          {item.suggestedPlan && (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/settings/billing">
                Upgrade to {PLAN_LABELS[item.suggestedPlan]} <ArrowUpRightIcon size={16} />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Entitlement({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="text-dense mt-0.5">{value}</dd>
    </div>
  );
}

export function UsageDashboard() {
  // Server-seeded on first paint (settings/usage/page.tsx) → useQuery reads the
  // hydrated cache; falls back to a client fetch when the seed is missing.
  const usageQ = useQuery(usageQuery());
  const data = usageQ.data ?? null;

  if (usageQ.isError) {
    return (
      <div className="flex flex-col gap-8">
        <SettingsPageHead
          title="Usage"
          description="Where you stand against your plan, and when each limit resets."
        />
        <SettingsError
          title="Usage didn't load"
          error={usageQ.error}
          onRetry={() => void usageQ.refetch()}
        />
      </div>
    );
  }
  // Head first, then the meters: this component owns the page title, so a bare
  // skeleton would blank it and let the whole page jump when data lands.
  if (!data)
    return (
      <div className="flex flex-col gap-8">
        <SettingsPageHead
          title="Usage"
          description="Where you stand against your plan, and when each limit resets."
        />
        <SettingMetersSkeleton rows={5} />
      </div>
    );

  const limits = PLAN_LIMITS[data.plan];

  // Boxless, like the overview since patch-30: depth comes from the rule and the
  // rhythm, not from a border around everything.
  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHead
        title="Usage"
        description="Where you stand against your plan, and when each limit resets."
        action={<Badge variant="outline">{PLAN_LABELS[data.plan]} plan</Badge>}
      />

      <SettingsSection title="Limits">
        <div className="flex flex-col">
          {data.items.map((it) => (
            <UsageRow key={it.dimension} item={it} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={`What ${PLAN_LABELS[data.plan]} includes`}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Entitlement
            label="Scan cadence"
            value={CADENCE_LABEL[limits.scrapeFrequency] ?? limits.scrapeFrequency}
          />
          <Entitlement label="Alert channels" value={limits.allowedChannels.join(", ")} />
          <Entitlement
            label="Monitored sources"
            value={`${limits.allowedSources.length} types`}
          />
          <Entitlement
            label="History kept"
            value={`${limits.historyRetentionDays} days`}
          />
          <Entitlement
            label="Realtime alerts"
            value={limits.features.realtimeAlerts ? "Included" : "Business only"}
          />
          <Entitlement
            label="Public API"
            value={limits.features.api ? "Included" : "Business only"}
          />
        </dl>
      </SettingsSection>
    </div>
  );
}
