import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Precision Instrument buttons (design-system §4). Radius 6 (rounded-md), gap 8,
// transition 150ms on the system ease-out curve. Press feedback = scale 0.97 on
// :active — visible on touch, where :hover never fires (Tailwind v4 gates hover:
// behind @media(hover:hover)); every variant ALSO darkens/tints on :active so a tap
// changes the fill, not just the size. touch-manipulation kills the 300ms tap delay.
// focus ring 3px at Iris/35. Disabled drops to .4 opacity.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap outline-none transition-all duration-[150ms] ease-out touch-manipulation focus-visible:ring-[3px] focus-visible:ring-ring/35 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary — Iris fill, soft directional shadow (E2).
        default:
          "bg-primary text-primary-foreground shadow-e2 hover:bg-accent-bright active:bg-accent-dim",
        // Secondary — raised surface (#171B22) + reinforced 14% border.
        secondary:
          "border border-border-strong bg-secondary text-secondary-foreground hover:bg-surface-3 active:bg-surface-3",
        // Ghost — transparent, muted label, neutral hover surface.
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent active:text-foreground",
        // Danger — transparent + critical (severity), tints on interaction.
        danger:
          "text-critical hover:bg-critical/10 active:bg-critical/15",
        // Destructive — filled critical (kept for existing destructive actions).
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive/30",
        // Outline — hairline border on the canvas.
        outline:
          "border border-border bg-background hover:bg-accent hover:text-foreground active:bg-accent active:text-foreground",
        // Link — Iris-on-dark text; underlines on press, no scale shrink.
        link: "text-link underline-offset-4 hover:underline active:underline active:scale-100",
      },
      size: {
        // md (default) h38 / 14px / px16 · sm h32 / 13px / px12 · lg h44 / 15px / px20.
        default: "h-[38px] px-4 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 text-dense has-[>svg]:px-2.5",
        lg: "h-11 px-5 text-content has-[>svg]:px-4",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: "size-[38px]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  // Slot (asChild) calls React.Children.only — it must receive a SINGLE child,
  // so the spinner only renders for real buttons. asChild callers stay
  // responsible for their own loading state.
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      disabled={asChild ? disabled : disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
