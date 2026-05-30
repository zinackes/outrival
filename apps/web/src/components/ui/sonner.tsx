"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
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
            "bg-background border-border text-muted-foreground hover:text-foreground",
          success: "border-positive/40 bg-positive/[0.08] text-foreground",
          error: "border-critical/40 bg-critical/[0.08] text-foreground",
        },
      }}
    />
  );
}
