"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // The list scrolls horizontally when the tabs overflow. Nothing may stick out
  // BELOW its padding box: `overflow-x: auto` forces `overflow-y: auto`, so even
  // one stray pixel makes the strip vertically scrollable and it swallows the
  // wheel instead of letting the page scroll. Same reason there is no
  // `touch-pan-x` here — it would make a vertical swipe started on the strip do
  // nothing on mobile; the default `touch-action` pans the strip sideways and
  // the page vertically.
  "group/tabs-list inline-flex w-fit max-w-full items-center justify-center overflow-x-auto text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden group-data-[orientation=horizontal]/tabs:overscroll-x-contain group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "rounded-md p-[3px] bg-muted group-data-[orientation=horizontal]/tabs:h-9",
        line: "gap-0 bg-transparent rounded-none border-b border-border w-full",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

const tabsTriggerClass = cn(
    "relative inline-flex items-center justify-center gap-1.5 px-3 py-2 text-dense font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 select-none",
    "group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
    "hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",

    // default variant — soft pill on muted track
    "group-data-[variant=default]/tabs-list:rounded-sm group-data-[variant=default]/tabs-list:h-[calc(100%-1px)] group-data-[variant=default]/tabs-list:flex-1",
    "group-data-[variant=default]/tabs-list:data-[state=active]:bg-background group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=default]/tabs-list:data-[state=active]:font-semibold",

    // line variant — underline indicator, no background fill
    "group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-transparent",
    "group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:font-semibold",
    // underline bar via ::after — sits ON the trigger's bottom edge, flush
    // above the list's border-b. It must not hang past it (cf. the list).
    "group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:bottom-0 group-data-[variant=line]/tabs-list:after:h-[2px] group-data-[variant=line]/tabs-list:after:bg-foreground group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:after:transition-opacity group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100"
)

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerClass, className)}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}


/**
 * The same strip, without the tab semantics — for a bar that FILTERS a list
 * rendered somewhere else on the page.
 *
 * Radix's Trigger stamps `aria-controls` with the id of the TabsContent it
 * expects to find. The three filter bars in the app never rendered one, so every
 * trigger pointed at an id that does not exist and assistive tech got a broken
 * relationship on the busiest list views in the product (`ux:25`, axe
 * aria-valid-attr-value, 12 nodes). Declaring empty panels would satisfy the
 * validator and still lie: the list is not inside them.
 *
 * So these are toggle buttons in a group, which is what a filter bar is —
 * `aria-pressed` says which one is on, and each is its own tab stop instead of
 * one roving stop that needs arrow keys. Pixel-identical: both halves reuse the
 * Radix strip's own class lists and its `data-state` hook.
 */
function FilterTabs({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs"
      /* Horizontal only: a filter bar has never been rendered as a rail, and the
         vertical variants stay on the Radix Tabs above. */
      data-orientation="horizontal"
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FilterTabList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof tabsListVariants>) {
  return (
    <div
      role="group"
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function FilterTab({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      data-slot="tabs-trigger"
      data-state={active ? "active" : "inactive"}
      aria-pressed={active}
      className={cn(tabsTriggerClass, className)}
      {...props}
    />
  )
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  FilterTabs,
  FilterTabList,
  FilterTab,
  tabsListVariants,
}
