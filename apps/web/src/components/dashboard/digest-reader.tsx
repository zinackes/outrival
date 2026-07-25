"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCopy, Download, Loader2, Mail } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { api, ApiError, type DigestDetail } from "@/lib/api";
import { digestDetailQuery, digestsQuery } from "@/lib/queries";
import { digestToMarkdown } from "@/lib/digest-markdown";
import {
  digestHeadline,
  digestLabel,
  digestStats,
  digestSupportingPoints,
  isQuietDigest,
} from "@/lib/digest-shape";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { DigestView, SupportingPoints } from "./digest-view";
import { ActivityGauge, MoverList, RailLabel, type ColorOf } from "./digest-parts";

/**
 * The reader for one brief (/dashboard/digests/[id]).
 *
 * A brief is a document, so it is set as one: a single reading column that opens on
 * the week's verdict, with the analyst's apparatus (who moved, how it was delivered,
 * how to take it away, what it cost to produce) held in a rail beside it.
 */
export function DigestReader({ id }: { id: string }) {
  const q = useQuery(digestDetailQuery(id));
  // Only used for the previous/next issue links; a miss just hides them.
  const listQ = useQuery(digestsQuery());
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const detail = q.data;
  const d = detail?.digest;

  const neighbours = useMemo(() => {
    if (!d) return { previous: null, next: null };
    const siblings = (listQ.data ?? []).filter((x) => x.period === d.period);
    const i = siblings.findIndex((x) => x.id === d.id);
    if (i === -1) return { previous: null, next: null };
    // The list is newest first, so the NEXT issue sits above and the previous below.
    return { previous: siblings[i + 1] ?? null, next: siblings[i - 1] ?? null };
  }, [d, listQ.data]);

  async function handleSend() {
    if (!d || !detail) return;
    setSending(true);
    try {
      const { sentAt } = await api.sendDigest(d.id);
      queryClient.setQueryData(digestDetailQuery(id).queryKey, {
        ...detail,
        digest: { ...d, sentAt },
      } satisfies DigestDetail);
      void queryClient.invalidateQueries({ queryKey: digestsQuery().queryKey });
      toast.success("Brief sent by email.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_recipient") {
        toast.info("Add a recipient email in Delivery settings first.");
      } else {
        toast.error("Couldn't send the brief. Try again.");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCopy() {
    if (!d) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(digestToMarkdown(d));
      toast.success("Brief copied as Markdown.");
    } catch {
      toast.error("Couldn't reach the clipboard. Check your browser permissions.");
    } finally {
      setCopying(false);
    }
  }

  const backLink = (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className="-mb-1 self-start px-0 hover:bg-transparent"
    >
      <Link href="/dashboard/digests">
        <ArrowLeft size={12} /> All digests
      </Link>
    </Button>
  );

  if (q.isLoading && !d) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading brief…
        </div>
      </div>
    );
  }

  if (!d || !detail) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <EmptyState
          icon={Mail}
          title="Brief not found"
          description="This brief doesn't exist or is no longer available."
        />
      </div>
    );
  }

  const content = d.content;
  const stats = digestStats(content);
  const quiet = isQuietDigest(content);
  const headline = digestHeadline(content);
  const points = digestSupportingPoints(content);
  const temperature =
    content?.temperature === "high"
      ? "high"
      : content?.temperature === "moderate"
        ? "moderate"
        : "low";
  const periodWord = d.period === "daily" ? "Daily brief" : "Weekly brief";

  // The section links already carry each competitor's colour and id, so the rail is
  // built from the payload the page has: no roster query, no second waterfall.
  const identity = new Map<string, { id: string | null; color: string | null }>();
  (content?.sections ?? []).forEach((s, i) => {
    const key = s.competitor?.toLowerCase().trim();
    if (!key || identity.has(key)) return;
    const link = detail.links?.[i];
    identity.set(key, { id: link?.competitorId ?? null, color: link?.competitorColor ?? null });
  });
  const colorOf: ColorOf = (name) => identity.get(name.toLowerCase().trim())?.color ?? null;
  const idOf = (name: string) => identity.get(name.toLowerCase().trim())?.id ?? null;

  // Outside /dashboard on purpose: the sheet must not inherit the app shell.
  const printHref = `/brief/${d.id}?print=1`;

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      {/* The reading column IS the measure, so the grid track is sized to it rather
          than to 1fr with a cap inside. As 1fr the cell outgrew its own text and
          parked the dead space between the brief and the rail, which reads as a
          layout bug rather than as a margin. */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,82ch)_284px] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-dense text-muted-foreground">
              <span>{periodWord}</span>
              <span aria-hidden className="text-border-strong">
                /
              </span>
              <span className="font-mono tabular-nums">{digestLabel(d)}</span>
            </div>

            {/* The model already writes the week's verdict as its first TL;DR point.
                It leads the page instead of sitting under a "TL;DR" label. */}
            <h1 className="m-0 text-title font-semibold leading-tight tracking-tight text-balance md:text-title-lg">
              {quiet ? "All quiet this period" : (headline ?? digestLabel(d))}
            </h1>

            {!quiet && points.length > 0 && <SupportingPoints points={points} />}
          </header>

          {!quiet && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-y border-border py-2.5 text-dense text-muted-foreground">
              <span>
                <b className="font-mono font-medium tabular-nums text-foreground">
                  {stats.moves}
                </b>{" "}
                moves
              </span>
              <span aria-hidden className="text-border-strong">
                /
              </span>
              <span>
                <b className="font-mono font-medium tabular-nums text-foreground">
                  {stats.action}
                </b>{" "}
                need an answer
              </span>
              <span aria-hidden className="text-border-strong">
                /
              </span>
              <span>
                <b className="font-mono font-medium tabular-nums text-foreground">
                  {stats.movers.length}
                </b>{" "}
                {stats.movers.length === 1 ? "competitor" : "competitors"}
              </span>
              <span aria-hidden className="text-border-strong">
                /
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ActivityGauge level={temperature} />
                activity {temperature}
              </span>
            </div>
          )}

          {content && <DigestView content={content} links={detail.links} lead={false} />}

          {(neighbours.previous || neighbours.next) && (
            <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Other briefs">
              {neighbours.previous ? (
                <Link
                  href={`/dashboard/digests/${neighbours.previous.id}`}
                  className="flex flex-col gap-0.5 rounded-md border border-border px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-xs text-muted-foreground">Previous brief</span>
                  <span className="font-mono text-dense tabular-nums">
                    {digestLabel(neighbours.previous)}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {neighbours.next ? (
                <Link
                  href={`/dashboard/digests/${neighbours.next.id}`}
                  className="flex flex-col gap-0.5 rounded-md border border-border px-4 py-3 text-right transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-xs text-muted-foreground">Next brief</span>
                  <span className="font-mono text-dense tabular-nums">
                    {digestLabel(neighbours.next)}
                  </span>
                </Link>
              ) : (
                <div className="flex flex-col gap-0.5 rounded-md border border-dashed border-border px-4 py-3 text-right">
                  <span className="text-xs text-muted-foreground">Next brief</span>
                  <span className="text-dense text-muted-foreground">
                    {d.period === "daily" ? "When activity warrants" : "Lands Monday"}
                  </span>
                </div>
              )}
            </nav>
          )}
        </div>

        {/* 68px = the 52px topbar (sticky top-0 z-20, see topbar.tsx) plus a
            16px gap, so the rail parks below it instead of sliding underneath.
            Bounded and scrollable: a brief naming a dozen competitors makes the
            rail taller than the viewport, and a pinned column whose foot is
            unreachable hides the export buttons. */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-[68px] lg:max-h-[calc(100dvh-84px)] lg:overflow-y-auto">
          {stats.movers.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <RailLabel>Who moved</RailLabel>
              <MoverList
                movers={stats.movers}
                total={stats.moves}
                colorOf={colorOf}
                idOf={idOf}
              />
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <RailLabel>Delivery</RailLabel>
            <p className="m-0 text-dense leading-relaxed text-muted-foreground">
              {d.sentAt ? (
                <>
                  Emailed on{" "}
                  <b className="font-medium text-foreground">
                    {format(new Date(d.sentAt), "MMM d")} at{" "}
                    {format(new Date(d.sentAt), "HH:mm")}
                  </b>
                  .
                </>
              ) : (
                "Not emailed yet."
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={sending}
              onClick={handleSend}
            >
              {sending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Mail size={13} />
              )}
              {d.sentAt ? "Send again" : "Send by email"}
            </Button>
          </div>

          <div className="flex flex-col gap-2.5">
            <RailLabel>Take it with you</RailLabel>
            <Button variant="outline" size="sm" className="w-full justify-start" asChild>
              <a href={printHref} target="_blank" rel="noopener noreferrer">
                <Download size={13} /> Save as PDF
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={copying}
              onClick={handleCopy}
            >
              {copying ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ClipboardCopy size={13} />
              )}
              Copy as Markdown
            </Button>
          </div>

          {detail.provenance && (
            <div className="flex flex-col gap-2">
              <RailLabel>Behind this brief</RailLabel>
              <ProvenanceLine label="Pages watched" value={detail.provenance.pages} />
              <ProvenanceLine label="Changes found" value={detail.provenance.changes} />
              <ProvenanceLine label="Made the brief" value={stats.moves} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProvenanceLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-dense">
      <span>{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}
