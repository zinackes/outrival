"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeftIcon, PrinterIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * The only interactive part of the printable sheet, and the only part that is not
 * printed. Arriving with ?print=1 (the reader's "Save as PDF") opens the browser's
 * print dialog straight away; arriving without it leaves the sheet readable on
 * screen, which is what a shared link wants.
 */
export function PrintControls({ backHref, auto }: { backHref: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    // One frame for fonts and layout to settle, otherwise the dialog can snapshot a
    // half-laid-out page on a cold load.
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
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
