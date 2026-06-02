import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type {
  OnboardingStep,
  ProductProfile,
  ProjectStage,
} from "@/lib/api";
import type { Plan } from "@outrival/shared";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Onboarding",
  description: "Set up your competitive intelligence in 5 steps.",
  robots: { index: false, follow: false },
};

interface Status {
  onboardingCompleted: boolean;
  onboardingStep: OnboardingStep | null;
  projectStage: ProjectStage | null;
  profile: ProductProfile | null;
  plan: Plan;
}

async function getSession(h: Headers) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/auth/get-session`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

async function getOnboardingStatus(h: Headers): Promise<Status | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/onboarding/status`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function OnboardingPage() {
  const h = await headers();
  const [session, status] = await Promise.all([
    getSession(h),
    getOnboardingStatus(h),
  ]);

  if (!session) redirect("/auth");
  // A fully completed run lands on "done". Skipped users (completed, step !== "done")
  // and re-onboarding users (step reset to "stage") stay here.
  if (status?.onboardingCompleted && status.onboardingStep === "done") {
    redirect("/dashboard");
  }

  return (
    <OnboardingForm
      plan={status?.plan ?? "free"}
      initialStage={status?.projectStage ?? null}
      initialStep={status?.onboardingStep ?? null}
      initialProfile={status?.profile ?? null}
    />
  );
}
