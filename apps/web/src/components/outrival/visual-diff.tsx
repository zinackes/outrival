"use client";

// Auth'd proxy images served from the API (org-scoped, dynamic) — next/image's
// optimizer/remotePatterns are the wrong tool here, so we use plain <img>.
/* eslint-disable @next/next/no-img-element */

import { useCallback, useRef, useState } from "react";
import { ArrowsOutIcon, CaretLeftIcon, CaretRightIcon } from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// How close to an edge the wipe has to get before that side's label is naming a
// pane nobody can see any more.
const EDGE = 8;

function captionDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : formatDate(d, { month: "short", day: "numeric" });
}

// Before/after screenshots for a signal's change. The panel is narrow, so the
// default is a wipe (before on the left, after on the right, drag the handle to
// move the seam); "Side by side" opens both captures full width in a dialog.
//
// The seam and the labels have to agree. They did not: the after capture was
// revealed from the LEFT while the "Before" label sat on that same left edge, so
// the pane labelled Before was showing the newest capture — i.e. the page as it
// looks now — and every reading of the change came out backwards.
export function VisualDiff({
  signalId,
  fill = false,
  beforeCapturedAt,
  afterCapturedAt,
  onUnavailable,
}: {
  signalId: string;
  // Fill the parent's height instead of the standalone 420px box. For the
  // "Why this insight?" panel, where this sits in a column of a fixed-height
  // grid: the height is still definite (the grid row decides it), so the
  // no-reflow property below is kept, it just comes from the parent.
  fill?: boolean;
  // When each capture was taken. Two pictures with no interval between them
  // don't say whether the change landed overnight or over a month.
  beforeCapturedAt?: string | null;
  afterCapturedAt?: string | null;
  // Called when a capture can't be fetched (the availability flag on the detail
  // is a pHash proxy, so R2 can still miss). The caller drops its whole section
  // — heading included — rather than framing a message where an image was
  // promised.
  onUnavailable?: () => void;
}) {
  const [pos, setPos] = useState(50);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  // Both captures, not just the base one: hiding the skeleton on the first load
  // uncovered a half-drawn comparison.
  const [loaded, setLoaded] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const beforePane = useRef<HTMLDivElement>(null);
  const afterPane = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const beforeUrl = `${BASE}/api/signals/${signalId}/screenshot/before`;
  const afterUrl = `${BASE}/api/signals/${signalId}/screenshot/after`;
  const beforeDate = captionDate(beforeCapturedAt);
  const afterDate = captionDate(afterCapturedAt);

  const fail = () => {
    setFailed(true);
    onUnavailable?.();
  };

  const seamAt = useCallback((clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  // Scrolling one pane of the dialog while the other stayed put meant comparing
  // two different parts of the page — the one thing a side-by-side is for.
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (syncing.current || !from || !to) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  if (failed) return null;

  return (
    // In fill mode the box below is `flex-1` of THIS column, so this column has
    // to claim the parent's leftover height itself — without flex-1 it sizes to
    // its content, the absolutely-positioned captures measure 0, and the whole
    // diff collapses to the controls row alone.
    <div className={cn("space-y-2", fill && "flex min-h-0 flex-1 flex-col")}>
      {/* Fixed height, not max-height. These are full-page captures served from
          R2 with no intrinsic size known up front, so letting the image define
          the box meant the whole document below it jumped the moment each one
          decoded — the scroll went out from under the reader mid-read. The box
          is the size it will settle at (a full-page capture at this width is
          always taller than the cap), both images fill it, and nothing reflows.
          content-visibility lets the browser skip painting it while it is off
          screen, with the same height reserved so the scrollbar stays honest. */}
      <div
        ref={frameRef}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seamAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seamAt(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className={cn(
          // touch-pan-y, not touch-none: the drag is horizontal, so the page must
          // still scroll vertically when a thumb starts on the capture.
          "relative cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-lg border border-border bg-surface-2",
          fill
            ? // The parent only has a definite height from md up (that is where
              // the grid row fixes it); below it the dialog scrolls as one
              // document, so the box states its own height instead of growing
              // into an auto-height parent, which resolves to nothing.
              "h-[300px] md:h-auto md:min-h-0 md:flex-1"
            : "h-[420px] [contain-intrinsic-size:auto_420px] [content-visibility:auto]",
        )}
      >
        {loaded < 2 && (
          <div aria-hidden className="absolute inset-0 animate-pulse bg-surface-3" />
        )}
        {/* Before is the base layer, and it owns the LEFT of the seam. */}
        <img
          src={beforeUrl}
          alt="The page before the change"
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded((n) => n + 1)}
          onError={fail}
          className="pointer-events-none absolute inset-0 size-full select-none object-cover object-top"
        />
        {/* After overlays it at the same size, clipped OFF on the left up to the
            seam — so it occupies exactly the right side, under its own label. */}
        <img
          src={afterUrl}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded((n) => n + 1)}
          onError={fail}
          className="pointer-events-none absolute inset-0 size-full select-none object-cover object-top"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        />

        {/* Seam + handle. The handle is the accessible control: it carries the
            slider role so the comparison is drivable from the keyboard, which a
            bare draggable line is not. */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-[var(--link)]"
          style={{ left: `${pos}%` }}
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label="Reveal before versus after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pos)}
            aria-valuetext={`${Math.round(pos)}% before, ${100 - Math.round(pos)}% after`}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 2;
              if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
              else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
              else if (e.key === "Home") setPos(0);
              else if (e.key === "End") setPos(100);
              else return;
              e.preventDefault();
            }}
            className="pointer-events-auto absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-[var(--link)] bg-background text-[var(--link)] shadow-sm outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
          >
            <CaretLeftIcon className="size-3.5 -mr-1" aria-hidden />
            <CaretRightIcon className="size-3.5 -ml-1" aria-hidden />
          </div>
        </div>

        <Caption side="left" label="Before" date={beforeDate} dimmed={pos < EDGE} />
        <Caption side="right" label="After" date={afterDate} dimmed={pos > 100 - EDGE} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground">Drag the handle to compare</p>
        <Button variant="outline" size="sm" onClick={() => setFull(true)}>
          <ArrowsOutIcon size={16} /> Side by side
        </Button>
      </div>

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="text-base">Visual change</DialogTitle>
          <div className="grid grid-cols-2 gap-4">
            <figure className="min-w-0 space-y-1.5">
              <figcaption className="text-meta text-muted-foreground">
                Before{beforeDate ? ` · ${beforeDate}` : ""}
              </figcaption>
              <div
                ref={beforePane}
                onScroll={() => syncScroll(beforePane.current, afterPane.current)}
                className="max-h-[72vh] overflow-auto rounded-md border border-border"
              >
                <img
                  src={beforeUrl}
                  alt="The page before the change"
                  draggable={false}
                  decoding="async"
                  className="block w-full"
                />
              </div>
            </figure>
            <figure className="min-w-0 space-y-1.5">
              <figcaption className="text-meta text-foreground">
                After{afterDate ? ` · ${afterDate}` : ""}
              </figcaption>
              <div
                ref={afterPane}
                onScroll={() => syncScroll(afterPane.current, beforePane.current)}
                className="max-h-[72vh] overflow-auto rounded-md border border-border"
              >
                <img
                  src={afterUrl}
                  alt="The page after the change"
                  draggable={false}
                  decoding="async"
                  className="block w-full"
                />
              </div>
            </figure>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A label pinned to the side of the seam its capture occupies. It fades out once
// that side is wiped away, so a label never names a pane that isn't on screen.
function Caption({
  side,
  label,
  date,
  dimmed,
}: {
  side: "left" | "right";
  label: string;
  date: string | null;
  dimmed: boolean;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-2 z-10 inline-flex items-center gap-1.5 rounded-md bg-background/85 px-2 py-1 text-meta backdrop-blur-sm transition-opacity",
        side === "left" ? "left-2" : "right-2",
        dimmed ? "opacity-0" : "opacity-100",
      )}
    >
      <span className={side === "left" ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      {date && <span className="tabular-nums text-muted-foreground">{date}</span>}
    </span>
  );
}
