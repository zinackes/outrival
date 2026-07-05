import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type {
  OnboardingStep,
  ProductProfile,
  ProjectStage,
} from "@/lib/api";
import type { Plan } from "@outrival/shared";
import { getSessionOutcome, getServerJson } from "@/lib/server-session";
import { SessionReconnect } from "@/components/outrival/session-reconnect";
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

async function getOnboardingStatus(h: Headers): Promise<Status | null> {
  return getServerJson<Status>("/api/onboarding/status", h);
}

export default async function OnboardingPage() {
  const h = await headers();
  // Same session-gate discipline as the dashboard layout: redirect to /auth only
  // on a DEFINITIVE "no session", and hold (rather than bounce) on an indeterminate
  // read, so a transient API hiccup can't flap the URL /onboarding↔/auth.
  const sessionOutcome = await getSessionOutcome(h);
  if (sessionOutcome.state === "unauthenticated") redirect("/auth");
  if (sessionOutcome.state === "indeterminate") return <SessionReconnect />;

  const status = await getOnboardingStatus(h);

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
