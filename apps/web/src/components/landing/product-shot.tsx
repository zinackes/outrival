"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowsOutIcon } from "@phosphor-icons/react/ssr";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// A single "This is the product" capture that opens full-size in a lightbox on
// click. Kept as its own client component so ProductShowcase stays a server
// component — only the zoom interaction needs the client boundary.

type ProductShotProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  caption: string;
};

export function ProductShot({
  src,
  alt,
  width,
  height,
  sizes,
  caption,
}: ProductShotProps) {
  const [open, setOpen] = useState(false);

  return (
    <figure className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge screenshot: ${caption}`}
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          className="h-auto w-full"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100"
        >
          <ArrowsOutIcon className="size-3.5" />
          Enlarge
        </span>
      </button>
      <figcaption className="text-dense text-text-subtle">{caption}</figcaption>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{caption}</DialogTitle>
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes="(min-width: 1152px) 1152px, 92vw"
            className="h-auto w-full rounded-xl border border-border bg-surface shadow-2xl shadow-black/40"
          />
        </DialogContent>
      </Dialog>
    </figure>
  );
}
