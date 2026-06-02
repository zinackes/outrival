import type { Metadata } from "next";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Access your Outrival competitive intelligence workspace with a magic link, Google, or a password.",
  alternates: { canonical: "/auth" },
  robots: { index: false, follow: false },
};

// Session redirect (→ /dashboard) is handled by the (auth) group layout.
export default function AuthPage() {
  return <AuthForm />;
}
