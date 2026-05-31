import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Outrival account and start monitoring competitors in minutes. 2 competitors free, no credit card.",
  alternates: { canonical: "/register" },
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterForm />;
}
