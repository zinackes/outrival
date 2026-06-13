"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  Brain,
  ListChecks,
  Users,
  Rocket,
  MessageSquare,
  ThumbsUp,
  ShieldAlert,
  DollarSign,
  ScrollText,
  Unplug,
  BellRing,
  Gauge,
  Boxes,
  Network,
  Send,
  Telescope,
  Sparkles,
  HeartPulse,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavSection = { title?: string; items: NavItem[] };

// Grouped by domain so the flat 21-item list reads as sections (Control /
// Scraping / AI / Delivery / Growth / Support). The first group is unlabeled —
// it's the control tower. Cost sits under AI (it's mostly AI/proxy spend).
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard },
      { href: "/admin/system", label: "System", icon: HeartPulse },
      { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
    ],
  },
  {
    title: "Scraping",
    items: [
      { href: "/admin/scraping", label: "Scraping", icon: Activity },
      { href: "/admin/monitors-health", label: "Monitors health", icon: Gauge },
      { href: "/admin/scraping-edge-cases", label: "Edge cases", icon: Unplug },
      { href: "/admin/platform-detection", label: "Platform", icon: Network },
      { href: "/admin/enrichment", label: "Enrichment", icon: Sparkles },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/admin/ai", label: "AI", icon: Brain },
      { href: "/admin/feedback-quality", label: "AI quality", icon: ThumbsUp },
      { href: "/admin/ai-review-queue", label: "AI review", icon: ShieldAlert },
      { href: "/admin/cost", label: "Cost", icon: DollarSign },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/admin/notification-moderation", label: "Notifications", icon: BellRing },
      { href: "/admin/delivery", label: "Delivery", icon: Send },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/admin/onboarding", label: "Onboarding", icon: Rocket },
      { href: "/admin/discovery", label: "Discovery", icon: Telescope },
      { href: "/admin/multi-product", label: "Products", icon: Boxes },
      { href: "/admin/business", label: "Business", icon: TrendingUp },
    ],
  },
  {
    title: "Support",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
      { href: "/admin/audit", label: "Audit", icon: ScrollText },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-3">
      {SECTIONS.map((section, i) => (
        <div key={section.title ?? `group-${i}`} className="flex flex-col gap-0.5">
          {section.title ? (
            <span className="px-3 pb-1 text-meta font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </span>
          ) : null}
          {section.items.map(({ href, label, icon: Icon }) => {
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
        </div>
      ))}
    </nav>
  );
}
