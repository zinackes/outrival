import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AdminDashboard } from "./admin-dashboard";
import type {
  AdminOverview,
  AdminScrapingHealth,
  AdminAiHealth,
  AdminCost,
  AdminFeedbackRow,
  AdminAuditEntry,
} from "@/lib/api";

export const metadata: Metadata = {
  title: "Admin ops",
  robots: { index: false, follow: false },
};

const API = process.env.NEXT_PUBLIC_API_URL;

// Allowlist gate — operator emails only, NEVER the org "owner" role. The API
// re-checks the same allowlist on every /api/admin/* call (defense in depth);
// this server-side check just yields a clean 404 instead of rendering a shell.
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string | null | undefined): boolean {
  return !!email && adminEmails.includes(email.toLowerCase());
}

async function getJson<T>(path: string, h: Headers): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { headers: h, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const h = await headers();
  const session = await getJson<{ user?: { email?: string } }>(
    "/api/auth/get-session",
    h,
  );
  if (!isAdmin(session?.user?.email)) notFound();

  const [overview, scraping, ai, cost, feedback, audit] = await Promise.all([
    getJson<AdminOverview>("/api/admin/overview", h),
    getJson<AdminScrapingHealth>("/api/admin/scraping-health", h),
    getJson<AdminAiHealth>("/api/admin/ai-health", h),
    getJson<AdminCost>("/api/admin/cost", h),
    getJson<{ feedback: AdminFeedbackRow[] }>("/api/admin/feedback", h),
    getJson<{ auditLog: AdminAuditEntry[] }>("/api/admin/audit-log", h),
  ]);

  return (
    <AdminDashboard
      overview={overview}
      scraping={scraping}
      ai={ai}
      cost={cost}
      feedback={feedback?.feedback ?? []}
      audit={audit?.auditLog ?? []}
    />
  );
}
