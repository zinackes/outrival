import * as React from "react";
import { cn } from "@/lib/utils";

// Canonical "eyebrow" — a small uppercase category/section label. Sans-serif (not
// mono), lightly tracked, muted. Mirrors the dashboard sidebar group labels so every
// eyebrow on the app reads the same. Size is the one dimension meant to flex per
// context (dense table rows stay `micro`, standalone labels go `meta`/`xs`).
const EYEBROW_SIZE = {
  micro: "text-micro",
  meta: "text-meta",
  xs: "text-xs",
} as const;

export type EyebrowSize = keyof typeof EYEBROW_SIZE;

export function eyebrowClass(size: EyebrowSize = "meta") {
  return cn(
    EYEBROW_SIZE[size],
    "font-medium uppercase tracking-wide text-muted-foreground",
  );
}

export function Eyebrow({
  size = "meta",
  className,
  ...props
}: React.ComponentProps<"span"> & { size?: EyebrowSize }) {
  return <span className={cn(eyebrowClass(size), className)} {...props} />;
}
