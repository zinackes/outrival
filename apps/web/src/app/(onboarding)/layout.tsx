import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Onboarding",
  description:
    "Initial setup of your Outrival workspace.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
