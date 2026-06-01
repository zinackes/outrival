import { headers } from "next/headers";
import { notFound } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

// Allowlist of operator emails — NEVER the org "owner" role. The API re-gates
// every /api/admin/* call; this is the UX gate (clean 404, no shell render).
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Server-side fetch that forwards the incoming request cookies to the API.
export async function adminFetch<T>(path: string): Promise<T | null> {
  try {
    const h = await headers();
    const res = await fetch(`${API}${path}`, { headers: h, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<string> {
  const session = await adminFetch<{ user?: { email?: string } }>(
    "/api/auth/get-session",
  );
  const email = session?.user?.email;
  if (!email || !adminEmails.includes(email.toLowerCase())) notFound();
  return email;
}
