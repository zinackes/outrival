"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  Loader2,
  Mail,
  RefreshCw,
  Settings as SettingsIcon,
  ArrowRight,
  Flame,
  Activity,
  Minus,
} from "lucide-react";
import { EmptyState } from "./empty-state";
import { endOfDay, format, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";
import { api, type Digest } from "@/lib/api";
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
import { CatPill } from "./cat-pill";
import { StatusPill } from "./status-pill";
import { DigestSettingsSheet } from "./digest-settings-sheet";
import { TableSkeleton } from "./skeletons";

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

const TEMP_MAP: Record<
  string,
  { Ic: typeof Flame; color: string; label: string }
> = {
  agitée: { Ic: Flame, color: "var(--accent)", label: "high" },
  haute: { Ic: Flame, color: "var(--accent)", label: "high" },
  high: { Ic: Flame, color: "var(--accent)", label: "high" },
  modérée: { Ic: Activity, color: "var(--muted)", label: "moderate" },
  moderate: { Ic: Activity, color: "var(--muted)", label: "moderate" },
  calme: { Ic: Minus, color: "var(--muted-2)", label: "low" },
  faible: { Ic: Minus, color: "var(--muted-2)", label: "low" },
  low: { Ic: Minus, color: "var(--muted-2)", label: "low" },
};

function TempIcon({ level }: { level: string }) {
  const m = TEMP_MAP[level] ?? TEMP_MAP.low!;
  const Ic = m.Ic;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-dense"
      style={{ color: m.color }}
    >
      <Ic size={13} />
      {m.label}
    </span>
  );
}

function urgencyMeta(urgency: string) {
  if (urgency === "action_required") {
    return { title: "Action required", color: "var(--critical)" };
  }
  if (urgency === "watch") {
    return { title: "Watch", color: "var(--accent)" };
  }
  return { title: "FYI", color: "var(--muted)" };
}

function fmtWeek(start: string, end: string) {
  try {
    const s = new Date(start);
    const e = new Date(end);
    return `${format(s, "MMM d")} → ${format(e, "MMM d, yyyy")}`;
  } catch {
    return `${start} → ${end}`;
  }
}

export function DigestsView() {
  // Server-seeded on first paint (digests/page.tsx) → useQuery reads the hydrated
  // cache; falls back to a client fetch when the seed is missing.
  const queryClient = useQueryClient();
  const digestsQ = useQuery(digestsQuery());
  const digests = digestsQ.data ?? null;
  const err = digestsQ.error;
  const [active, setActive] = useState<Digest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genRange, setGenRange] = useState<DateRange>(() => DIGEST_PRESETS[0]!.range());

  async function handleGenerate(range: DateRange) {
    setGenerating(true);
    try {
      const { digest, reason } = await api.generateDigest(range);
      if (!digest) {
        toast.info(
          reason === "no_signals"
            ? "No signals in this range yet — nothing to summarize."
            : "Could not generate a digest.",
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: digestsQuery().queryKey });
      setActive(digest);
      toast.success("Digest generated.");
    } catch (e) {
      toastApiError(e, { title: "Couldn't generate the digest" });
    } finally {
      setGenerating(false);
    }
  }

  if (err && digests === null) return <ListError error={err} />;

  if (active) return <DigestReader d={active} onBack={() => setActive(null)} />;

  return (
    <div className="space-y-6">
      <PageHead
        title="Weekly digests"
        sub="Sent every Monday at 09:00. Next: Monday June 1."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={12} /> Settings
            </Button>
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
        }
      />

      <DigestSettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      {digests === null && <TableSkeleton rows={5} columns={5} />}

      {digests && digests.length === 0 && (
        <EmptyState
          icon={Mail}
          title="No digest yet"
          description="The next digest is generated automatically every Monday morning."
        />
      )}

      {digests && digests.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-dense min-w-[640px]">
            <thead className="bg-background">
              <tr>
                {["Week", "Signals", "Critical", "Activity", "Sent"].map(
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
              {digests.map((d) => {
                const sections = d.content?.sections ?? [];
                const crit = sections.filter(
                  (s) => s.urgency === "action_required",
                ).length;
                return (
                  <tr
                    key={d.id}
                    onClick={() => setActive(d)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActive(d);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open digest for ${fmtWeek(d.weekStart, d.weekEnd)}`}
                    className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset"
                  >
                    <td className="px-3.5 py-3 align-middle font-medium">
                      {fmtWeek(d.weekStart, d.weekEnd)}
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

function DigestReader({ d, onBack }: { d: Digest; onBack: () => void }) {
  const sections = d.content?.sections ?? [];
  const tldr = d.content?.tldr ?? [];
  const crit = sections.filter((s) => s.urgency === "action_required");
  const watch = sections.filter((s) => s.urgency === "watch");
  const fyi = sections.filter((s) => s.urgency === "fyi");

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-mb-2 self-start px-0 hover:bg-transparent"
      >
        <ArrowLeft size={12} /> Back to digests
      </Button>

      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-title font-bold tracking-tight m-0">
            Digest · {fmtWeek(d.weekStart, d.weekEnd)}
          </h1>
          <div className="text-muted-foreground text-dense mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span>{sections.length} signals</span>
            <span className="text-muted-foreground">·</span>
            <span>{crit.length} critical</span>
            <span className="text-muted-foreground">·</span>
            <span>activity</span>
            <TempIcon level={d.content?.temperature ?? "low"} />
            {d.sentAt && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>
                  sent {format(new Date(d.sentAt), "EEEE HH:mm")}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title="PDF export coming soon"
          >
            <Download size={13} /> PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Email resend coming soon"
          >
            <Mail size={13} /> Resend
          </Button>
        </div>
      </div>

      {tldr.length > 0 && (
        <Card className="px-5 py-5">
          <div className="text-xs font-semibold text-primary mb-3">
            TL;DR
          </div>
          <ul className="m-0 pl-5 text-content leading-relaxed">
            {tldr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Card>
      )}

      {[crit, watch, fyi].map((items, idx) => {
        if (items.length === 0) return null;
        const meta = urgencyMeta(items[0]!.urgency);
        return <DigestSection key={idx} meta={meta} items={items} />;
      })}
    </div>
  );
}

function DigestSection({
  meta,
  items,
}: {
  meta: { title: string; color: string };
  items: Array<{
    urgency: string;
    competitor: string;
    category: string;
    insight: string;
    so_what: string;
  }>;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-sm"
            style={{ background: meta.color }}
            aria-hidden
          />
          <div className="font-semibold text-sm tracking-tight">
            {meta.title}
          </div>
        </div>
        <span className="text-muted-foreground tabular-nums font-mono text-xs">
          {items.length} signals
        </span>
      </div>
      <div>
        {items.map((s, i) => (
          <div
            key={i}
            className="p-5 border-b border-border last:border-b-0"
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <CatPill>{s.category}</CatPill>
              <span className="font-semibold text-sm">{s.competitor}</span>
            </div>
            <p className="m-0 mb-1.5 text-content leading-snug font-medium">
              {s.insight}
            </p>
            {s.so_what && (
              <p className="m-0 flex gap-1 text-muted-foreground text-sm leading-snug">
                <ArrowRight className="size-3.5 mt-0.5 shrink-0" />
                {s.so_what}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
