"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  EnvelopeIcon,
  FunnelSimpleIcon,
  SpinnerIcon,
} from "@/components/icons";
import { storySummary } from "@outrival/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { CatText } from "./cat-pill";
import { MemoryTimeline } from "./digest-view";
import { MoverList, MoverName, RailLabel, type ColorOf, type UrlOf } from "./digest-parts";
import { digestInProgressDetailQuery } from "@/lib/queries";
import { digestLabel, digestRunLabel, URGENCY_META, URGENCY_ORDER } from "@/lib/digest-shape";
import type { InProgressSignal } from "@/lib/api";

/**
 * The week being collected, opened.
 *
 * Deliberately NOT the digest reader with a flag: there is no brief here. Nothing has
 * been written, so there is nothing to send, export, copy or rate — every control the
 * reader carries would be a button that cannot do its job. What this page owes the
 * reader is the raw material and the one thing they cannot see anywhere else: which of
 * it will actually reach Monday's email.
 */
export function InProgressReader() {
  const q = useQuery(digestInProgressDetailQuery());
  const wip = q.data ?? null;

  const backLink = (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="-mb-1 self-start px-0 hover:bg-transparent"
    >
      <Link href="/dashboard/digests">
        <ArrowLeftIcon size={16} /> All digests
      </Link>
    </Button>
  );

  if (q.isLoading && !wip) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-6">
        {backLink}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon size={16} className="animate-spin" /> Loading this week…
        </div>
      </div>
    );
  }

  // Reachable by typing the URL, and by leaving the tab open across a Monday 08:00:
  // once the cron writes the brief this week stops being in progress and the page has
  // nothing left to describe. Point at the thing that replaced it.
  if (!wip) {
    return (
      <div className="mx-auto flex w-full max-w-[980px] flex-col gap-6">
        {backLink}
        <EmptyState
          icon={EnvelopeIcon}
          title="No week in progress"
          description="Either nothing has moved since the last brief, or this week's brief has already been written. Both live on the digests list."
        />
      </div>
    );
  }

  const collected = wip.signals ?? [];
  const inBrief = collected.filter((s) => s.inBrief);
  const dropped = collected.filter((s) => !s.inBrief);
  const stories = wip.competitorStories ?? [];
  const storiesOmitted = wip.competitorStoriesOmitted ?? 0;

  const identity = new Map<string, { color: string | null; url: string | null; id: string | null }>();
  for (const s of collected) {
    const key = s.competitor.toLowerCase().trim();
    if (!identity.has(key)) {
      identity.set(key, { color: s.competitorColor, url: s.competitorUrl, id: s.competitorId });
    }
  }
  const colorOf: ColorOf = (name) => identity.get(name.toLowerCase().trim())?.color ?? null;
  const idOf = (name: string) => identity.get(name.toLowerCase().trim())?.id ?? null;
  const urlOf: UrlOf = (name) => identity.get(name.toLowerCase().trim())?.url ?? null;

  const groups = URGENCY_ORDER.map((urgency) => ({
    urgency,
    items: inBrief.filter((s) => s.urgency === urgency),
  })).filter((g) => g.items.length > 0);

  return (
    // Same measure as the digest reader: this is read as a document, and the list it
    // came from is the thing that uses the full width.
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-6">
      {backLink}

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_284px] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-dense text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full border border-border-strong" />
                In progress
              </span>
              <span aria-hidden className="text-border-strong">
                /
              </span>
              <span className="tabular-nums">
                {digestLabel({
                  period: "weekly",
                  weekStart: wip.weekStart,
                  weekEnd: wip.weekEnd,
                })}
              </span>
            </div>

            <h1 className="m-0 text-title font-semibold leading-tight tracking-tight text-balance md:text-title-lg">
              <span className="tabular-nums">{wip.moves}</span>{" "}
              {wip.moves === 1 ? "move" : "moves"} collected for Monday&apos;s brief
            </h1>

            <p className="m-0 max-w-[72ch] text-content leading-relaxed text-muted-foreground">
              Nothing is written yet. Outrival writes this brief on{" "}
              {digestRunLabel(wip.nextRunAt)} and emails it to you. Anything that lands
              before then joins it.
            </p>
          </header>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-y border-border py-2.5 text-dense text-muted-foreground">
            <Stat value={wip.moves} label={wip.moves === 1 ? "move" : "moves"} />
            <Sep />
            <Stat value={wip.action} label="need an answer" />
            <Sep />
            <Stat
              value={wip.movers.length}
              label={wip.movers.length === 1 ? "competitor" : "competitors"}
            />
            {wip.cap.omitted > 0 && (
              <>
                <Sep />
                <Stat value={wip.cap.omitted} label="below the cut" />
              </>
            )}
          </div>

          {groups.map((group) => {
            const meta = URGENCY_META[group.urgency];
            return (
              <section key={group.urgency} className="flex flex-col">
                <div className="flex items-center gap-2.5 border-b border-border pb-2">
                  <span aria-hidden className={`h-3.5 w-[3px] rounded-[1px] ${meta.swatch}`} />
                  <h2 className="text-content font-semibold tracking-tight">{meta.label}</h2>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {group.items.length}
                  </span>
                </div>
                {group.items.map((s) => (
                  <CollectedMove key={s.id} signal={s} />
                ))}
              </section>
            );
          })}

          {/* The generator reads a fixed number of moves, so a busy week ships a brief
              that quietly leaves its tail out. Naming the tail is the only way the
              reader can tell "Outrival saw nothing" from "the email had no room". */}
          {dropped.length > 0 && (
            <section className="flex flex-col">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-dashed border-border pb-2">
                <h2 className="text-content font-semibold tracking-tight text-muted-foreground">
                  Below the cut
                </h2>
                <p className="m-0 text-xs text-muted-foreground">
                  The brief carries the{" "}
                  <span className="tabular-nums">{wip.cap.max}</span> most severe moves.
                  These stay in the app.
                </p>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {dropped.length}
                </span>
              </div>
              {dropped.map((s) => (
                <CollectedMove key={s.id} signal={s} muted />
              ))}
            </section>
          )}

          {/* Accumulated memory (OUT-172), the one block on this page that is not about
              this week. It renders here rather than through the reader's MemoryBand
              because a card would break the page's boxless rhythm — the rail itself is
              the shared component, so a fact reads the same here, in the brief and on
              the competitor page. Computed live, so the ages are as of now: this is the
              week under construction, not a frozen article. */}
          {stories.length > 0 && (
            <section className="flex flex-col">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-border pb-2">
                <h2 className="text-content font-semibold tracking-tight">
                  What you know now
                </h2>
                <p className="m-0 text-xs text-muted-foreground">
                  The whole watch, not just this week. Monday&apos;s brief carries it too.
                </p>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {stories.length}
                </span>
              </div>
              {stories.map((story) => (
                <div
                  key={story.competitorId}
                  className="border-b border-border py-4 last:border-b-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <h3 className="m-0 text-content font-medium tracking-tight">
                      {story.competitor}
                    </h3>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {storySummary(story)}
                    </span>
                  </div>
                  <MemoryTimeline story={story} />
                </div>
              ))}
              {storiesOmitted > 0 && (
                <p className="m-0 pt-3 text-xs text-muted-foreground">
                  +{storiesOmitted} more competitor{storiesOmitted === 1 ? "" : "s"} with a
                  history on file
                </p>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-[68px] lg:max-h-[calc(100dvh-84px)] lg:overflow-y-auto">
          {wip.movers.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <RailLabel>Who has moved</RailLabel>
              <MoverList
                movers={wip.movers}
                total={wip.moves}
                colorOf={colorOf}
                idOf={idOf}
                urlOf={urlOf}
              />
            </div>
          )}

          {/* No send button, on purpose. There is no document to send, and a disabled
              control here would read as a feature that is broken rather than as one
              that does not apply yet. */}
          <div className="flex flex-col gap-2.5">
            <RailLabel>Delivery</RailLabel>
            <p className="m-0 text-dense leading-relaxed text-muted-foreground">
              Not written yet. It is emailed to you automatically on{" "}
              <b className="font-medium text-foreground">{digestRunLabel(wip.nextRunAt)}</b>.
            </p>
            <Button variant="outline" size="sm" className="w-full justify-start" asChild>
              <Link href="/dashboard/digests">
                <EnvelopeIcon size={16} /> Delivery settings
              </Link>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-border-strong">
      /
    </span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <b className="font-medium tabular-nums text-foreground">{value}</b> {label}
    </span>
  );
}

/**
 * One collected move. Same anatomy as a move inside a written brief — finding, then
 * consequence, then the exits — so opening the finished article on Monday is not a
 * different reading experience from watching it fill up.
 */
function CollectedMove({ signal, muted = false }: { signal: InProgressSignal; muted?: boolean }) {
  const competitorHref = signal.competitorId
    ? `/dashboard/competitors/${signal.competitorId}`
    : null;

  return (
    <article className="group border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-dense">
        <MoverName
          name={signal.competitor}
          color={signal.competitorColor}
          href={competitorHref}
        />
        {signal.category && <CatText category={signal.category} />}
      </div>

      <p
        className={`m-0 mt-2 max-w-[72ch] text-content leading-relaxed ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {signal.insight}
      </p>

      {signal.soWhat && (
        <p className="m-0 mt-2 flex max-w-[72ch] gap-2.5 text-content leading-relaxed text-muted-foreground">
          <ArrowRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{signal.soWhat}</span>
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {competitorHref && (
          <Link
            href={competitorHref}
            className="inline-flex items-center gap-1.5 text-dense text-link hover:underline underline-offset-2"
          >
            <ArrowUpRightIcon size={14} aria-hidden />
            Open {signal.competitor}
          </Link>
        )}
        <Link
          href={`/dashboard/signals?focus=${signal.id}`}
          className="inline-flex items-center gap-1.5 text-dense text-link hover:underline underline-offset-2"
        >
          <FunnelSimpleIcon size={14} aria-hidden />
          See the signal
        </Link>
      </div>
    </article>
  );
}
