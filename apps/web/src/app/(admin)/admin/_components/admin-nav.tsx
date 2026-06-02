"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  Brain,
  ListChecks,
  Users,
  MessageSquare,
  ThumbsUp,
  ShieldAlert,
  DollarSign,
  ScrollText,
  Unplug,
} from "lucide-react";

const ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/scraping", label: "Scraping", icon: Activity },
  { href: "/admin/scraping-edge-cases", label: "Edge cases", icon: Unplug },
  { href: "/admin/ai", label: "AI", icon: Brain },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/admin/feedback-quality", label: "AI quality", icon: ThumbsUp },
  { href: "/admin/ai-review-queue", label: "AI review", icon: ShieldAlert },
  { href: "/admin/cost", label: "Cost", icon: DollarSign },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        // /admin matches exactly; sub-routes match the exact path or a deeper
        // segment (the trailing slash keeps /scraping from matching
        // /scraping-edge-cases).
        const active =
          href === "/admin"
            ? pathname === "/admin"
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
