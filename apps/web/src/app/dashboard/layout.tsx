import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PostHogIdentitySync } from "@/lib/posthog/identity-sync";
import { TimezoneSync } from "@/components/outrival/timezone-sync";
import { FeedbackWidget } from "@/components/outrival/feedback-widget";
import { NpsPrompt } from "@/components/outrival/nps-prompt";
import { OnboardingBanner } from "@/components/outrival/onboarding-banner";
import { OnboardingResumeBanner } from "@/components/onboarding/resume-banner";
import { AiStatusBanner } from "@/components/outrival/ai-status-banner";
import { StructuralChangeBanner } from "@/components/outrival/structural-change-banner";
import type { OnboardingSession } from "@/lib/api";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

async function getSession(h: Headers) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/auth/get-session`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

async function getOnboardingStatus(
  h: Headers,
): Promise<{
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  profile: unknown;
} | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/onboarding/status`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  return res.json();
}

async function getResumeSession(
  h: Headers,
): Promise<OnboardingSession | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/onboarding-session/current`,
    { headers: h, cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { session: OnboardingSession | null };
  return data.session;
}

async function getBilling(h: Headers): Promise<{
  plan?: string;
  competitorsUsed?: number;
  competitorsLimit?: number | null;
} | null> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/billing`, {
    headers: h,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    plan?: string;
    usage?: { competitors?: { used?: number; limit?: number | null } };
  };
  return {
    plan: data.plan,
    competitorsUsed: data.usage?.competitors?.used,
    competitorsLimit: data.usage?.competitors?.limit ?? null,
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const cookieStore = await cookies();

  const [session, status, billing, resumeSession] = await Promise.all([
    getSession(h),
    getOnboardingStatus(h),
    getBilling(h),
    getResumeSession(h),
  ]);

  if (!session) redirect("/auth");
  // Skip mode grants dashboard access without completing onboarding.
  if (status && !status.onboardingCompleted && !status.onboardingSkipped) {
    redirect("/onboarding");
  }
  // The richer resume banner supersedes the bare onboarding nudge when there's an
  // unfinished session to pick up.
  const showOnboardingBanner = Boolean(
    !resumeSession && status?.onboardingSkipped && !status?.profile,
  );

  const user = {
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
  };
  const org = {
    name: session?.user?.name
      ? `${session.user.name.split(" ")[0]} workspace`
      : "Workspace",
    plan: billing?.plan ? billing.plan : "Free",
    seatsUsed: billing?.competitorsUsed,
    seatsLimit: billing?.competitorsLimit ?? undefined,
  };

  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const defaultOpen = sidebarCookie == null ? true : sidebarCookie === "true";

  const userId = session?.user?.id as string | undefined;

  return (
    <DashboardShell user={user} org={org} defaultOpen={defaultOpen}>
      {userId && <PostHogIdentitySync userId={userId} plan={org.plan} />}
      {userId && <TimezoneSync />}
      {resumeSession && <OnboardingResumeBanner session={resumeSession} />}
      {showOnboardingBanner && <OnboardingBanner />}
      <AiStatusBanner />
      <div className="px-4 pt-4 sm:px-6 empty:hidden">
        <StructuralChangeBanner />
      </div>
      {children}
      <FeedbackWidget />
      <NpsPrompt />
    </DashboardShell>
  );
}
