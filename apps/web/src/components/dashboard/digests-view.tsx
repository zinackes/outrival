"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  CaretRightIcon,
  SpinnerIcon,
  EnvelopeIcon,
  ArrowsClockwiseIcon,
  GearIcon,
  ArrowRightIcon,
  DownloadSimpleIcon,
} from "@/components/icons";
import { differenceInCalendarDays, endOfDay, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { EmptyState } from "./empty-state";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";
import { api, type Digest } from "@/lib/api";
import { feedItemMotion } from "@/lib/motion";
import { competitorsQuery, digestsQuery } from "@/lib/queries";
import {
  digestHeadline,
  digestLabel,
  digestStats,
  digestSupportingPoints,
  isQuietDigest,
  quietSentence,
} from "@/lib/digest-shape";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DateRangePicker,
  lastNDays,
  type DateRange,
  type DatePreset,
} from "@/components/ui/date-range-picker";
import { PageHead } from "./page-head";
import { DigestSettingsSheet } from "./digest-settings-sheet";
import {
  ActivityGauge,
  CompetitorMovers,
  MoverList,
  RailLabel,
  SpreadBar,
  spreadSentence,
  type ColorOf,
  type UrlOf,
} from "./digest-parts";

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

function temperatureOf(d: Digest): "low" | "moderate" | "high" {
  const t = d.content?.temperature ?? d.temperature;
  return t === "high" ? "high" : t === "moderate" ? "moderate" : "low";
}

/** A brief covering the last day or two is "this week", not an archive entry. */
function isCurrent(d: Digest): boolean {
  const end = new Date(d.weekEnd);
  if (Number.isNaN(end.getTime())) return false;
  return differenceInCalendarDays(new Date(), end) <= 1;
}

export function DigestsView() {
  // Server-seeded on first paint (digests/page.tsx) → useQuery reads the hydrated
  // cache; falls back to a client fetch when the seed is missing.
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const digestsQ = useQuery(digestsQuery());
  // Seeded on the same page. Only used to tint and link the competitors a brief
  // names, so a miss degrades to neutral dots and plain text.
  const competitorsQ = useQuery(competitorsQuery());
  const digests = digestsQ.data ?? null;
  const err = digestsQ.error;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genRange, setGenRange] = useState<DateRange>(() => DIGEST_PRESETS[0]!.range());

  // The roster endpoint already excludes the self-competitor, so every name here is
  // a real competitor the brief could be naming.
  const roster = useMemo(() => {
    const byName = new Map<string, { id: string; color: string | null; url: string | null }>();
    for (const c of competitorsQ.data ?? []) {
      byName.set(c.name.toLowerCase().trim(), { id: c.id, color: c.color, url: c.url });
    }
    return byName;
  }, [competitorsQ.data]);

  const colorOf: ColorOf = (name) => roster.get(name.toLowerCase().trim())?.color ?? null;
  const idOf = (name: string) => roster.get(name.toLowerCase().trim())?.id ?? null;
  const urlOf = (name: string) => roster.get(name.toLowerCase().trim())?.url ?? null;

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
  const [lead, ...earlier] = rows;

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
    <div className="flex flex-col gap-5">
      <PageHead
        flush
        title="Digests"
        sub="Your weekly brief lands every Monday, 08:00 UTC."
        actions={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <GearIcon size={16} /> Delivery
          </Button>
        }
      />

      <DigestSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(["weekly", "daily"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-[5px] px-3 py-1.5 text-dense transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === t
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "weekly" ? "Weekly" : "Daily"}
              <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                {t === "weekly" ? weekly.length : daily.length}
              </span>
            </button>
          ))}
        </div>

        {/* The masthead stays calm: writing a brief off-schedule is an occasional
            action, so its controls sit on the toolbar rather than beside the title. */}
        {tab === "weekly" && (
          <div className="flex items-center gap-2">
            <DateRangePicker value={genRange} onChange={setGenRange} presets={DIGEST_PRESETS} />
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              onClick={() => handleGenerate(genRange)}
            >
              {generating ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : (
                <ArrowsClockwiseIcon size={16} />
              )}
              Write one now
            </Button>
          </div>
        )}
      </div>

      {digests === null && <DigestsSkeleton />}

      {digests !== null && rows.length === 0 && (
        <EmptyState
          icon={EnvelopeIcon}
          title={tab === "daily" ? "No daily briefings yet" : "No weekly brief yet"}
          description={
            tab === "daily"
              ? "A daily briefing lands here when urgent competitor activity is deferred to it."
              : "The next brief is written automatically every Monday morning."
          }
        />
      )}

      {lead && (
        <LeadBrief digest={lead} tab={tab} colorOf={colorOf} idOf={idOf} urlOf={urlOf} />
      )}

      {earlier.length > 0 && (
        <section className="flex flex-col">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="text-content font-semibold tracking-tight">Earlier briefs</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {earlier.length}
            </span>
          </div>
          {/* Weekly and daily are two different lists behind one control, so the
              swap carries the competitors-list choreography rather than repainting
              in place. */}
          <AnimatePresence initial={false} mode="popLayout">
            {earlier.map((d) => (
              <motion.div key={d.id} {...feedItemMotion}>
                <RunRow digest={d} colorOf={colorOf} />
              </motion.div>
            ))}
          </AnimatePresence>
        </section>
      )}
    </div>
  );
}

/**
 * The newest brief, open on the page. A weekly product's list should answer "what
 * happened this week" before anything is clicked; the old table answered it only
 * after one.
 */
function LeadBrief({
  digest,
  tab,
  colorOf,
  idOf,
  urlOf,
}: {
  digest: Digest;
  tab: Tab;
  colorOf: ColorOf;
  idOf: (name: string) => string | null;
  urlOf: UrlOf;
}) {
  const content = digest.content;
  const stats = digestStats(content);
  const quiet = isQuietDigest(content);
  const headline = digestHeadline(content);
  const points = digestSupportingPoints(content);
  const href = `/dashboard/digests/${digest.id}`;
  const kicker = isCurrent(digest)
    ? tab === "daily"
      ? "Today"
      : "This week"
    : "Latest brief";

  return (
    <Card className="grid grid-cols-1 overflow-hidden rounded-lg lg:grid-cols-[minmax(0,1fr)_236px]">
      {/* The card fills the page, its prose does not: a verdict set across 1400px
          stops being a sentence you can read in one pass. */}
      <div className="flex max-w-[78ch] flex-col p-5">
        <div className="flex items-center gap-2.5 text-dense text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wider text-primary">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            {kicker}
          </span>
          <span className="tabular-nums">{digestLabel(digest)}</span>
        </div>

        {quiet ? (
          <p className="mt-3 text-lg font-medium leading-snug tracking-tight text-balance">
            {quietSentence(content)}
          </p>
        ) : (
          <>
            {headline && (
              <h2 className="mt-3 text-lg font-medium leading-snug tracking-tight text-balance">
                {headline}
              </h2>
            )}
            {points.length > 0 && (
              <ul className="mt-3.5 flex flex-col gap-2">
                {points.map((p, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <span
                      aria-hidden
                      className="mt-2 size-1 shrink-0 rounded-full bg-border-strong"
                    />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" asChild>
            <Link href={href}>
              Read the brief
              <ArrowRightIcon size={16} />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={`/brief/${digest.id}?print=1`} target="_blank" rel="noopener noreferrer">
              <DownloadSimpleIcon size={16} /> Save as PDF
            </a>
          </Button>
        </div>
      </div>

      <aside className="flex flex-col gap-4 border-t border-border p-5 lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-2.5">
          <RailLabel>Who moved</RailLabel>
          {stats.movers.length > 0 ? (
            <MoverList
              movers={stats.movers}
              total={stats.moves}
              colorOf={colorOf}
              idOf={idOf}
              urlOf={urlOf}
            />
          ) : (
            <p className="text-dense text-muted-foreground">Nobody, this period.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <RailLabel>Activity</RailLabel>
          <span className="flex items-center gap-2 text-dense">
            <ActivityGauge level={temperatureOf(digest)} />
            <span className="capitalize">{temperatureOf(digest)}</span>
          </span>
        </div>
      </aside>
    </Card>
  );
}

/**
 * One earlier issue. A real link, not a click handler on a row, so middle-click and
 * open-in-new-tab work the way a list of documents should.
 */
function RunRow({ digest, colorOf }: { digest: Digest; colorOf: ColorOf }) {
  const content = digest.content;
  const stats = digestStats(content);
  const quiet = isQuietDigest(content);
  const headline = quiet ? quietSentence(content) : digestHeadline(content);

  return (
    <Link
      href={`/dashboard/digests/${digest.id}`}
      className="group -mx-2.5 grid grid-cols-1 items-center gap-x-5 gap-y-2 rounded-md border-b border-border px-2.5 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,190px)_128px_16px] sm:gap-y-0"
    >
      <span className="text-dense tabular-nums">{digestLabel(digest)}</span>
      <span
        className={`line-clamp-2 text-sm leading-snug ${
          quiet || !headline ? "text-muted-foreground" : ""
        }`}
      >
        {headline ?? "No summary was written for this period."}
      </span>
      <CompetitorMovers movers={stats.movers} colorOf={colorOf} />
      <span className="flex flex-col gap-1.5">
        <SpreadBar stats={stats} />
        <span className="text-xs text-muted-foreground">
          {quiet ? "Nothing to answer" : spreadSentence(stats)}
        </span>
      </span>
      <CaretRightIcon
        size={16}
        aria-hidden
        className="hidden text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 sm:block"
      />
    </Link>
  );
}

function DigestsSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Card className="grid grid-cols-1 gap-5 rounded-lg p-5 lg:grid-cols-[minmax(0,1fr)_236px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-2 h-8 w-36" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </Card>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border pb-3.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
