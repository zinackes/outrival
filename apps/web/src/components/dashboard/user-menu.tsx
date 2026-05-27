"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, LogOut, Settings } from "lucide-react";
import { signOut } from "@/lib/auth-client";
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
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="flex aspect-square size-7 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-surface-2"
        >
          {initials(user.name, "?")}
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
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings className="size-3.5" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/billing">
            <CreditCard className="size-3.5" /> Subscription
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
