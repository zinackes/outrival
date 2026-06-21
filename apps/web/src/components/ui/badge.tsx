import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Precision Instrument badges (design-system §4). Severity + status read as
// mono-caps pills (the data voice); the generic variants stay rounded-md chips.
// Severity is the only colored scale — never a "good/bad" judgement on data.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-foreground",
        link: "text-link underline-offset-4 [a&]:hover:underline",

        // Severity — pill + mono caps, tinted on the severity hue.
        low: "rounded-full border-low/25 bg-low/12 px-2 text-meta font-mono uppercase tracking-[0.08em] text-low",
        medium:
          "rounded-full border-medium/25 bg-medium/12 px-2 text-meta font-mono uppercase tracking-[0.08em] text-medium",
        high: "rounded-full border-high/25 bg-high/12 px-2 text-meta font-mono uppercase tracking-[0.08em] text-high",
        critical:
          "rounded-full border-critical/25 bg-critical/12 px-2 text-meta font-mono uppercase tracking-[0.08em] text-critical",

        // Status — Tracked (Iris) · Paused (muted) · New (filled Iris).
        tracked:
          "rounded-full border-primary/30 bg-primary/12 px-2 text-meta font-mono uppercase tracking-[0.08em] text-link",
        paused:
          "rounded-full border-border-strong bg-surface-2 px-2 text-meta font-mono uppercase tracking-[0.08em] text-muted-foreground",
        new: "rounded-full border-transparent bg-primary px-2 text-meta font-mono uppercase tracking-[0.08em] text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; dot?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && !asChild ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
