"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CreditCard, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      {
        href: "/dashboard/settings",
        label: "Notifications",
        icon: Bell,
        exact: true,
      },
      {
        href: "/dashboard/settings/billing",
        label: "Subscription",
        icon: CreditCard,
      },
    ],
  },
  {
    group: "Danger",
    items: [
      {
        href: "/dashboard/settings/danger",
        label: "Delete workspace",
        icon: Trash2,
      },
    ],
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="hidden lg:flex flex-col gap-6 sticky top-6 self-start">
        {NAV.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <div
              className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-2)] px-2 mb-1"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {g.group}
            </div>
            {g.items.map((it) => {
              const Ic = it.icon;
              const active = isActive(pathname, it.href, it.exact);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-surface text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface/60",
                  )}
                >
                  <Ic size={14} />
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <nav className="lg:hidden -mx-1 mb-2 overflow-x-auto">
        <div className="flex items-center gap-1 px-1 min-w-max">
          {NAV.flatMap((g) => g.items).map((it) => {
            const Ic = it.icon;
            const active = isActive(pathname, it.href, it.exact);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors",
                  active
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface/60",
                )}
              >
                <Ic size={12} />
                {it.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
