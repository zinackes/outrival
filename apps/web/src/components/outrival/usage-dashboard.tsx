"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge, ArrowUpRight } from "lucide-react";
import { PLAN_LABELS, PLAN_LIMITS } from "@outrival/shared";
import {
  api,
  type UsageSnapshot,
  type UsageItem,
  type UsageDimension,
} from "@/lib/api";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const DIMENSION_LABEL: Record<UsageDimension, string> = {
  competitors: "Competitors",
  products: "Products",
  battleCardsPerDay: "Battle cards",
  discoveriesPerMonth: "Discoveries",
  forcedRescansPerDay: "Forced re-scans",
};

const PERIOD_LABEL: Record<UsageItem["period"], string> = {
  current: "active",
  day: "today",
  month: "this month",
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
  return (
    <div className="py-3.5 border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-dense font-medium">{DIMENSION_LABEL[item.dimension]}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <span className={atLimit ? "text-critical" : "text-foreground"}>{item.used}</span>
          {" / "}
          {item.limit}
          <span className="text-muted-foreground"> · {PERIOD_LABEL[item.period]}</span>
        </span>
      </div>
      <Progress value={pct(item.used, item.limit)} className="mt-2 h-1.5" />
      {atLimit && (
        <div className="mt-2 flex items-center gap-2.5">
          <span className="text-xs text-muted-foreground">Limit reached.</span>
          {item.suggestedPlan && (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/settings/billing">
                Upgrade to {PLAN_LABELS[item.suggestedPlan]} <ArrowUpRight size={12} />
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
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .getUsage()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">Couldn&apos;t load usage right now.</p>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const limits = PLAN_LIMITS[data.plan];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge size={15} className="text-muted-foreground" aria-hidden />
            <span className="text-dense font-semibold tracking-tight">Plan limits</span>
          </div>
          <Badge variant="outline">{PLAN_LABELS[data.plan]}</Badge>
        </div>
        <div className="mt-1.5">
          {data.items.map((it) => (
            <UsageRow key={it.dimension} item={it} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <span className="text-dense font-semibold tracking-tight">Plan entitlements</span>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Entitlement
            label="Scrape cadence"
            value={CADENCE_LABEL[limits.scrapeFrequency] ?? limits.scrapeFrequency}
          />
          <Entitlement label="Alert channels" value={limits.allowedChannels.join(", ")} />
          <Entitlement
            label="Monitored sources"
            value={`${limits.allowedSources.length} types`}
          />
          <Entitlement
            label="History retention"
            value={`${limits.historyRetentionDays} days`}
          />
          <Entitlement
            label="Realtime alerts"
            value={limits.features.realtimeAlerts ? "Included" : "—"}
          />
          <Entitlement label="Public API" value={limits.features.api ? "Included" : "—"} />
        </dl>
      </div>
    </div>
  );
}
