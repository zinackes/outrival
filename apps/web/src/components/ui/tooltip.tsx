"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// Radix opens a tooltip on hover/focus and deliberately ignores touch pointers,
// so on mobile every tooltip in the app was unreachable. On a coarse pointer the
// Root becomes controlled here and a tap on the trigger toggles it (Radix still
// closes it on outside tap / Escape). Hover pointers keep the exact hover
// behaviour, and a call site that controls `open` itself is left alone.
type TouchTooltip = {
  onTriggerPointerDown: () => void
  onTriggerClick: () => void
}

const TouchTooltipContext = React.createContext<TouchTooltip | null>(null)

function useCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(hover: none)")
    const sync = () => setCoarse(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])
  return coarse
}

function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const coarse = useCoarsePointer()
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const isTouch = coarse && open === undefined

  // Snapshot the open state at pointerdown — Radix's own handlers close the
  // tooltip on that same event, so a second tap would otherwise reopen it.
  const openRef = React.useRef(false)
  openRef.current = open ?? internalOpen
  const wasOpenRef = React.useRef(false)

  function handleOpenChange(next: boolean) {
    setInternalOpen(next)
    onOpenChange?.(next)
  }

  const touch: TouchTooltip | null = isTouch
    ? {
        onTriggerPointerDown: () => {
          wasOpenRef.current = openRef.current
        },
        onTriggerClick: () => {
          if (!wasOpenRef.current) handleOpenChange(true)
        },
      }
    : null

  return (
    <TouchTooltipContext.Provider value={touch}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...(isTouch ? { open: internalOpen } : { open, defaultOpen })}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </TouchTooltipContext.Provider>
  )
}

function TooltipTrigger({
  onPointerDown,
  onClick,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const touch = React.useContext(TouchTooltipContext)
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(e) => {
        touch?.onTriggerPointerDown()
        onPointerDown?.(e)
      }}
      onClick={(e) => {
        touch?.onTriggerClick()
        onClick?.(e)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 w-fit max-w-[calc(100vw-1rem)] origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-balance text-popover-foreground shadow-e2 fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-b border-r border-border bg-popover fill-popover" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
