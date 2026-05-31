"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      theme={theme as "light" | "dark" | "system" | undefined}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-card border border-border text-foreground shadow-lg rounded-md",
          title: "text-[13px] font-medium leading-relaxed",
          description: "text-[12px] text-muted-foreground leading-relaxed",
          actionButton:
            "bg-foreground text-background font-medium text-[11px] font-mono uppercase tracking-widest",
          closeButton:
            "!bg-transparent !border-0 !left-auto !right-1.5 !top-1.5 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity",
          success: "border-positive/40 bg-positive/[0.08] text-foreground",
          error: "border-critical/40 bg-critical/[0.08] text-foreground",
        },
      }}
    />
  );
}
