"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Mail,
  RefreshCw,
  Settings as SettingsIcon,
  ArrowRight,
} from "lucide-react";
import { EmptyState } from "./empty-state";
import { endOfDay, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";
import { api } from "@/lib/api";
import { digestsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
  type DatePreset,
} from "@/components/ui/date-range-picker";
import { PageHead } from "./page-head";
import { SeverityPill } from "./severity-pill";
import { StatusPill } from "./status-pill";
import { DigestSettingsSheet } from "./digest-settings-sheet";
import { TableSkeleton } from "./skeletons";
import { TempIcon, digestLabel } from "./digest-reader";

const DIGEST_PRESETS: DatePreset[] = [
  {
    label: "This week",
    range: () => ({
      from: startOfWeek(new Date(), { weekStartsOn: 1 }),
      to: endOfDay(new Date()),
    }),
  },
  { label: "Last 7 days", range: () => lastNDays(7) },
  { label: "Last 30 days", range: () => lastNDays(30) },
];

type Tab = "weekly" | "daily";

export function DigestsView() {
  // Server-seeded on first paint (digests/page.tsx) → useQuery reads the hydrated
  // cache; falls back to a client fetch when the seed is missing.
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const digestsQ = useQuery(digestsQuery());
  const digests = digestsQ.data ?? null;
  const err = digestsQ.error;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genRange, setGenRange] = useState<DateRange>(() => DIGEST_PRESETS[0]!.range());

  const tab: Tab = searchParams.get("tab") === "daily" ? "daily" : "weekly";
  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "weekly") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const weekly = digests?.filter((d) => d.period !== "daily") ?? [];
  const daily = digests?.filter((d) => d.period === "daily") ?? [];
  const rows = tab === "daily" ? daily : weekly;

  async function handleGenerate(range: DateRange) {
    setGenerating(true);
    try {
      const { digest, reason } = await api.generateDigest(range);
      if (!digest) {
        toast.info(
          reason === "no_signals"
            ? "No signals in this range yet, nothing to summarize."
            : "Could not generate a digest.",
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: digestsQuery().queryKey });
      router.push(`/dashboard/digests/${digest.id}`);
    } catch (e) {
      toastApiError(e, { title: "Couldn't generate the digest" });
    } finally {
      setGenerating(false);
    }
  }

  if (err && digests === null) return <ListError error={err} />;

  return (
    <div className="space-y-6">
      <PageHead
        title="Digests"
        sub="Weekly briefing every Monday at 09:00 UTC · daily briefings when activity warrants."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={12} /> Settings
            </Button>
            {tab === "weekly" && (
              <>
                <DateRangePicker
                  value={genRange}
                  onChange={setGenRange}
                  presets={DIGEST_PRESETS}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={generating}
                  onClick={() => handleGenerate(genRange)}
                >
                  {generating ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Generate now
                </Button>
              </>
            )}
          </>
        }
      />

      <DigestSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />

      <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
        {(["weekly", "daily"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`px-3 py-1.5 text-dense rounded-[5px] transition-colors ${
              tab === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "weekly" ? "Weekly" : "Daily"}
            <span className="ml-1.5 tabular-nums font-mono text-xs text-muted-foreground">
              {t === "weekly" ? weekly.length : daily.length}
            </span>
          </button>
        ))}
      </div>

      {digests === null && <TableSkeleton rows={5} columns={5} />}

      {digests !== null && rows.length === 0 && (
        <EmptyState
          icon={Mail}
          title={tab === "daily" ? "No daily briefings yet" : "No weekly digest yet"}
          description={
            tab === "daily"
              ? "A daily briefing lands here when urgent competitor activity is deferred to it."
              : "The next digest is generated automatically every Monday morning."
          }
        />
      )}

      {digests !== null && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-dense min-w-[640px]">
            <thead className="bg-background">
              <tr>
                {[tab === "daily" ? "Day" : "Week", "Signals", "Critical", "Activity", "Sent"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-3.5 py-2.5 text-xs text-muted-foreground font-medium border-b border-border whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
                <th className="border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const sections = d.content?.sections ?? [];
                const crit = sections.filter(
                  (s) => s.urgency === "action_required",
                ).length;
                const open = () => router.push(`/dashboard/digests/${d.id}`);
                return (
                  <tr
                    key={d.id}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open();
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open digest for ${digestLabel(d)}`}
                    className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset"
                  >
                    <td className="px-3.5 py-3 align-middle font-medium">
                      {digestLabel(d)}
                    </td>
                    <td className="px-3.5 py-3 align-middle text-right tabular-nums font-mono">
                      {sections.length}
                    </td>
                    <td className="px-3.5 py-3 align-middle">
                      {crit > 0 ? (
                        <SeverityPill severity="critical">
                          {crit} critical
                        </SeverityPill>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 align-middle">
                      <TempIcon level={d.content?.temperature ?? "low"} />
                    </td>
                    <td className="px-3.5 py-3 align-middle">
                      {d.sentAt ? (
                        <StatusPill status="ok">sent</StatusPill>
                      ) : (
                        <StatusPill status="warn">pending</StatusPill>
                      )}
                    </td>
                    <td className="w-8 text-right px-3.5 py-3 align-middle">
                      <ArrowRight
                        size={14}
                        className="text-muted-foreground inline"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
