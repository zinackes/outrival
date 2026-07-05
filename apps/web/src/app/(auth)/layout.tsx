import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "@/lib/server-session";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your Outrival account to manage your competitive intelligence.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(await headers());
  if (session) redirect("/dashboard");

  return children;
}
