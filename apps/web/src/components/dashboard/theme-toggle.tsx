"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // resolvedTheme is unknown on the server — defer the icon until mount to
  // avoid a hydration mismatch.
  useEffect(() => setMounted(true), []);

  const currentLabel =
    OPTIONS.find((o) => o.value === theme)?.label ?? "System";

  return (
    <DropdownMenu>
      {/* Self-contained provider: ThemeToggle also renders on the public landing nav,
          which has no ancestor TooltipProvider (it lives only in the dashboard/admin/
          onboarding AppProviders). Without this, radix Tooltip throws at prerender of
          "/". Nesting inside the dashboard's provider is harmless (inner wins). */}
      <TooltipProvider delayDuration={80}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Toggle theme">
                {mounted && resolvedTheme === "dark" ? (
                  <MoonIcon size={16} />
                ) : (
                  <SunIcon size={16} />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Theme: {mounted ? currentLabel : "System"}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" sideOffset={8} className="w-36">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            data-active={mounted && theme === value}
            className="data-[active=true]:text-foreground text-muted-foreground"
          >
            <Icon className="size-4" /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
