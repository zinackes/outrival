"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BellIcon,
  CaretDownIcon,
  SignOutIcon,
  ChatCenteredDotsIcon,
  GearIcon,
  UserIcon,
} from "@phosphor-icons/react/ssr";
import { signOut } from "@/lib/auth-client";
import { resetUser } from "@/lib/posthog/events";
import { UserAvatar } from "@/components/dashboard/user-avatar";
import { FEEDBACK_OPEN_EVENT } from "@/components/outrival/feedback-widget";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserIcon {
  name: string | null;
  email: string | null;
}

export function UserMenu({ user }: { user: UserIcon }) {
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
          <UserAvatar seed={user.email ?? user.name ?? "user"} size={24} />
          <span
            className="hidden max-w-[160px] truncate text-sm font-medium text-foreground sm:block"
            data-ph-mask
          >
            {user.name ?? user.email ?? "Account"}
          </span>
          <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
            <UserIcon className="size-3.5" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/notifications">
            <BellIcon className="size-3.5" /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <GearIcon className="size-3.5" /> GearIcon
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            document.dispatchEvent(new CustomEvent(FEEDBACK_OPEN_EVENT))
          }
        >
          <ChatCenteredDotsIcon className="size-3.5" /> Send feedback
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <SignOutIcon className="size-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
