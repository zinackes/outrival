"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";
import {
  WarningIcon,
  CheckCircleIcon,
  InfoIcon,
  SpinnerIcon,
  XCircleIcon,
} from "@/components/icons";

export function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme as "light" | "dark" | "system" | undefined}
      position="bottom-right"
      closeButton
      // How long a toast stays is decided per KIND in lib/toast.ts, which every
      // call site goes through; this is only the floor for anything that reaches
      // sonner without one.
      duration={5000}
      // A batch action (scrape all sources, bulk-edit a roster) can resolve into
      // several toasts within a second or two. Sonner stacks the rest behind the
      // three on top instead of walking them up the whole right edge — the pile
      // was the distraction, not any single toast.
      visibleToasts={3}
      // Custom icons keep the toast palette inside the OKLCH design system
      // (severity tokens + --link) instead of sonner's generic richColors set.
      icons={{
        success: <CheckCircleIcon size={16} className="text-positive" />,
        error: <XCircleIcon size={16} className="text-critical" />,
        warning: <WarningIcon size={16} className="text-medium" />,
        info: <InfoIcon size={16} className="text-[var(--link)]" />,
        loading: <SpinnerIcon size={16} className="animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-card border border-border text-foreground shadow-lg rounded-md",
          title: "text-dense font-medium leading-relaxed",
          description: "text-xs text-muted-foreground leading-relaxed",
          actionButton:
            "bg-foreground text-background font-medium text-xs rounded px-2.5",
          cancelButton: "text-muted-foreground text-xs",
          // Sonner pulls the close button up with transform: translate(-35%,-35%),
          // which made it poke above the toast. Override the transform and center
          // it vertically instead so it sits cleanly on the right edge.
          closeButton:
            "!bg-transparent !border-0 !left-auto !right-2 !top-1/2 ![transform:translateY(-50%)] text-muted-foreground hover:text-foreground transition-colors",
          success: "border-positive/40 bg-positive/[0.08] text-foreground",
          error: "border-critical/40 bg-critical/[0.08] text-foreground",
          warning: "border-medium/40 bg-medium/[0.08] text-foreground",
          info: "border-[var(--link)]/40 bg-[var(--link)]/[0.08] text-foreground",
        },
      }}
    />
  );
}
