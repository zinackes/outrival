"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, PrinterIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * The only interactive part of the printable sheet, and the only part that is not
 * printed. Arriving with ?print=1 (the reader's "Save as PDF") opens the browser's
 * print dialog straight away; arriving without it leaves the sheet readable on
 * screen, which is what a shared link wants.
 *
 * The sheet is /brief/[id] for the digest of the same id, so the way back is read
 * off the route rather than threaded down as a prop: one destination, one source.
 */
export function PrintControls({ auto }: { auto: boolean }) {
  const params = useParams<{ id: string }>();
  const backHref = `/dashboard/digests/${params.id}`;

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    // Wait for the thing that actually made the old 400ms guess necessary: web fonts.
    // Printing before they land snapshots the fallback metrics, which reflows the
    // sheet mid-dialog. `fonts.ready` is the real signal, and the extra frame after
    // it lets the reflow it triggers paint. A browser without the Font Loading API
    // (or a font that never resolves) still prints, one frame in.
    const ready = document.fonts?.ready ?? Promise.resolve();
    void ready.then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [auto]);

  return (
    <div className="print-hide sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-[820px] items-center justify-between gap-4 px-5 py-2.5">
        <Button variant="ghost" size="sm" asChild className="px-0 hover:bg-transparent">
          <Link href={backHref}>
            <ArrowLeftIcon size={16} /> Back to the brief
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <PrinterIcon size={16} /> Print or save as PDF
        </Button>
      </div>
    </div>
  );
}
