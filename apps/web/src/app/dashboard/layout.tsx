import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { Home, Users, FileText, Bell, Settings } from "lucide-react";
import { LogoutButton } from "./logout-button";

async function getSession() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/auth/get-session`,
    { headers: await headers(), cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

const navItems = [
  { href: "/dashboard", label: "Activité", icon: Home },
  { href: "/dashboard/competitors", label: "Competitors", icon: Users },
  { href: "/dashboard/digests", label: "Digests", icon: FileText },
  { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside
        style={{
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          width: "220px",
          flexShrink: 0,
        }}
        className="flex flex-col py-6 px-4"
      >
        <div className="mb-8 px-2">
          <span
            style={{ fontFamily: "var(--font-syne)", fontSize: "20px" }}
            className="font-bold"
          >
            Out<span style={{ color: "var(--accent)" }}>rival</span>
          </span>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              style={{ borderRadius: "var(--radius)", color: "var(--muted)" }}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-white/5 hover:text-white transition-colors"
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        <LogoutButton />
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
