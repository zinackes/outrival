"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Settings } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { resetUser } from "@/lib/posthog/events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface User {
  name: string | null;
  email: string | null;
}

function initials(name?: string | null, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    resetUser();
    router.push("/auth");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="flex items-center gap-2 rounded-full p-0.5 sm:pr-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-surface-2"
        >
          <span className="flex aspect-square size-7 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-foreground">
            {initials(user.name, "?")}
          </span>
          <span
            className="hidden max-w-[140px] truncate text-sm font-medium text-foreground sm:block"
            data-ph-mask
          >
            {user.name ?? user.email ?? "Account"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <div className="grid leading-tight">
            <span className="truncate text-sm font-medium text-foreground">
              {user.name ?? "—"}
            </span>
            <span
              className="truncate text-xs font-normal text-muted-foreground"
              data-ph-mask
            >
              {user.email ?? ""}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* patch-29 — personal shortcuts; Profile joins here once its page ships. */}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/notifications">
            <Bell className="size-3.5" /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings className="size-3.5" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="size-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
