import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "./_lib/server";
import { AdminNav } from "./_components/admin-nav";
import { AdminMobileNav } from "./_components/admin-mobile-nav";

export const metadata: Metadata = {
  title: "Admin ops",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate once for every /admin/* page (404 if not on the allowlist).
  await requireAdmin();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl gap-6 p-6">
        <aside className="sticky top-6 hidden h-fit w-52 shrink-0 md:block">
          <Link href="/admin" className="mb-4 flex items-center gap-2 px-3">
            <span className="text-sm font-semibold">Outrival</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 text-meta uppercase tracking-wide text-muted-foreground">
              ops
            </span>
          </Link>
          <AdminNav />
        </aside>
        <main className="min-w-0 flex-1">
          <AdminMobileNav />
          {children}
        </main>
      </div>
    </div>
  );
}
