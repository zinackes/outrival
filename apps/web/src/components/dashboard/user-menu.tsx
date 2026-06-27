"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";
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
          className="flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground dark:data-[state=open]:bg-accent/50"
        >
          <User className="size-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
          <span
            className="hidden max-w-[160px] truncate text-sm font-medium text-foreground sm:block"
            data-ph-mask
          >
            {user.name ?? user.email ?? "Account"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
        {/* patch-29 — personal shortcuts to the two most-visited sections. */}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/profile">
            <User className="size-3.5" /> Profile
          </Link>
        </DropdownMenuItem>
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
