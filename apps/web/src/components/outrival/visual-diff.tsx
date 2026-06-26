"use client";

// Auth'd proxy images served from the API (org-scoped, dynamic) — next/image's
// optimizer/remotePatterns are the wrong tool here, so we use plain <img>.
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Before/after homepage screenshots for a signal's change. The panel is narrow, so
// the default is a wipe slider (one column, before underneath, after clipped from the
// right); a "Side by side" button opens the full-size two-column view.
export function VisualDiff({ signalId }: { signalId: string }) {
  const [pos, setPos] = useState(50);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);

  const beforeUrl = `${BASE}/api/signals/${signalId}/screenshot/before`;
  const afterUrl = `${BASE}/api/signals/${signalId}/screenshot/after`;

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        Screenshot preview unavailable for this change.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative max-h-[420px] overflow-hidden rounded-md border border-border bg-surface-2">
        {/* Before is the in-flow base (defines the height). */}
        <img
          src={beforeUrl}
          alt="Before the change"
          draggable={false}
          onError={() => setFailed(true)}
          className="block w-full select-none"
        />
        {/* After overlays it at the same width, revealed from the left up to `pos`. */}
        <img
          src={afterUrl}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 w-full select-none"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-[var(--link)]"
          style={{ left: `${pos}%` }}
        />
        <span className="absolute left-2 top-2 rounded-sm bg-background/80 px-1.5 py-0.5 text-meta text-muted-foreground">
          Before
        </span>
        <span className="absolute right-2 top-2 rounded-sm bg-background/80 px-1.5 py-0.5 text-meta text-foreground">
          After
        </span>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Reveal before versus after"
          className="h-1 flex-1 cursor-ew-resize accent-[var(--link)]"
        />
        <Button variant="outline" size="sm" onClick={() => setFull(true)}>
          <Maximize2 size={12} /> Side by side
        </Button>
      </div>

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="text-base">Visual change</DialogTitle>
          <div className="grid grid-cols-2 gap-4">
            <figure className="space-y-1.5">
              <figcaption className="text-meta text-muted-foreground">
                Before
              </figcaption>
              <div className="max-h-[72vh] overflow-auto rounded-md border border-border">
                <img
                  src={beforeUrl}
                  alt="Homepage before the change"
                  draggable={false}
                  className="block w-full"
                />
              </div>
            </figure>
            <figure className="space-y-1.5">
              <figcaption className="text-meta text-foreground">After</figcaption>
              <div className="max-h-[72vh] overflow-auto rounded-md border border-border">
                <img
                  src={afterUrl}
                  alt="Homepage after the change"
                  draggable={false}
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
