import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your Outrival account to manage your competitive intelligence.",
  robots: {
    index: false,
    follow: false,
  },
};

async function getSession(h: Headers) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/auth/get-session`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession(await headers());
  if (session) redirect("/dashboard");

  return children;
}
