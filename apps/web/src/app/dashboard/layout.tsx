import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { AppProviders } from "@/components/app-providers";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PageReveal } from "@/components/dashboard/page-reveal";
import { makeServerQueryClient } from "@/lib/server-query";
import { serverApiBase } from "@/lib/api-base";
import { getShellData } from "@/lib/api-server";
import {
  productsListQuery,
  structuralChangesQuery,
  aiStatusQuery,
  competitorsQuery,
  notificationsBellQuery,
  onboardingChecklistQuery,
} from "@/lib/queries";
import { PostHogIdentitySync } from "@/lib/posthog/identity-sync";
import { TimezoneSync } from "@/components/outrival/timezone-sync";
import { FeedbackWidget } from "@/components/outrival/feedback-widget";
import { NpsPrompt } from "@/components/outrival/nps-prompt";
import { OnboardingBanner } from "@/components/outrival/onboarding-banner";
import { OnboardingResumeBanner } from "@/components/onboarding/resume-banner";
import { AiStatusBanner } from "@/components/outrival/ai-status-banner";
import { NewSourcesBanner } from "@/components/outrival/new-sources-banner";
import { normalizeScope, PRODUCT_COOKIE } from "@/lib/product-scope";
import { TwoFactorNudgeBanner } from "@/components/outrival/two-factor-nudge-banner";
import { StructuralChangeBanner } from "@/components/outrival/structural-change-banner";
import { getSessionOutcome, getServerJson } from "@/lib/server-session";
import { SessionReconnect } from "@/components/outrival/session-reconnect";
import type { OnboardingSession } from "@/lib/api";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

// Resilient (retries transient failures) — this read GATES the onboarding
// redirect, so a single cold-Neon/API hiccup misreading it as null would
// fail-open and drop a brand-new, un-onboarded user straight onto the dashboard.
async function getOnboardingStatus(
  h: Headers,
): Promise<{
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  profile: unknown;
} | null> {
  return getServerJson("/api/onboarding/status", h);
}

async function getResumeSession(
  h: Headers,
): Promise<OnboardingSession | null> {
  const res = await fetch(`${serverApiBase()}/api/onboarding-session/current`, {
    headers: h,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { session: OnboardingSession | null };
  return data.session;
}

async function getBilling(h: Headers): Promise<{
  plan?: string;
  competitorsUsed?: number;
} | null> {
  // ?summary=1 — the layout only needs plan + competitor usage (DB-backed). This skips the
  // two sequential Stripe round-trips the full endpoint makes, which were the single
  // slowest fetch gating the dashboard's first paint on hard loads.
  const res = await fetch(`${serverApiBase()}/api/billing?summary=1`, {
    headers: h,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    plan?: string;
    usage?: { competitors?: { used?: number } };
  };
  return { plan: data.plan, competitorsUsed: data.usage?.competitors?.used };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const cookieStore = await cookies();

  // Resolve the session gate FIRST and ALONE. On /auth this same read runs by
  // itself and settles reliably; here it used to share a 5-way Promise.all, so
  // under a constrained backend get-session could be the one to fail while /auth's
  // lone read succeeded — /dashboard bounced to /auth, /auth bounced back, and the
  // URL flapped. Reading it on its own removes that contention, and holding on an
  // indeterminate answer (rather than bouncing) makes the loop impossible.
  const sessionOutcome = await getSessionOutcome(h);
  if (sessionOutcome.state === "unauthenticated") redirect("/auth");
  if (sessionOutcome.state === "indeterminate") return <SessionReconnect />;
  const session = sessionOutcome.session;

  // Active product scope read server-side from the cookie → seeds the client provider
  // so the first paint already knows the scope (no flash, no reconciliation effect).
  // Resolved BEFORE the shell fetch so the roster seed is scoped exactly like the
  // sidebar's own query key — a mismatch would write a cache entry it never reads.
  const productScope = normalizeScope(cookieStore.get(PRODUCT_COOKIE)?.value);

  const [status, billing, resumeSession, shell] = await Promise.all([
    getOnboardingStatus(h),
    getBilling(h),
    getResumeSession(h),
    getShellData(productScope ?? undefined),
  ]);

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
    plan: billing?.plan ? billing.plan : "Free",
    competitorsUsed: billing?.competitorsUsed,
  };

  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  const defaultOpen = sidebarCookie == null ? true : sidebarCookie === "true";

  const userId = session?.user?.id as string | undefined;
  // Read from the server session (same field SecuritySettings uses) and pass it down
  // so the nudge banner doesn't fire its own client get-session on every page.
  const twoFactorEnabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  // Seed the always-on shell widgets (switcher roster + the two banners) so they
  // land in the first paint instead of firing one client fetch each on mount.
  // Best-effort: a null field is skipped → that widget fetches client-side as before.
  const queryClient = makeServerQueryClient();
  if (shell.products) {
    queryClient.setQueryData(productsListQuery().queryKey, shell.products);
  }
  if (shell.structuralChanges) {
    queryClient.setQueryData(
      structuralChangesQuery().queryKey,
      shell.structuralChanges,
    );
  }
  if (shell.aiStatus) {
    queryClient.setQueryData(aiStatusQuery().queryKey, shell.aiStatus);
  }
  if (shell.competitors) {
    queryClient.setQueryData(
      competitorsQuery(productScope ?? undefined).queryKey,
      shell.competitors,
    );
  }
  if (shell.notifications) {
    queryClient.setQueryData(notificationsBellQuery().queryKey, shell.notifications);
  }
  if (shell.checklist) {
    queryClient.setQueryData(onboardingChecklistQuery().queryKey, shell.checklist);
  }

  return (
    <AppProviders>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardShell
          user={user}
          org={org}
          defaultOpen={defaultOpen}
          productScope={productScope}
        >
        {userId && <PostHogIdentitySync userId={userId} plan={org.plan} />}
        {userId && <TimezoneSync />}
        {resumeSession && <OnboardingResumeBanner session={resumeSession} />}
        {showOnboardingBanner && <OnboardingBanner />}
        <AiStatusBanner />
        <NewSourcesBanner />
        <TwoFactorNudgeBanner twoFactorEnabled={twoFactorEnabled} />
        <div className="px-4 pt-4 sm:px-6 empty:hidden">
          <StructuralChangeBanner />
        </div>
        <PageReveal>{children}</PageReveal>
        <FeedbackWidget />
        <NpsPrompt />
        </DashboardShell>
      </HydrationBoundary>
    </AppProviders>
  );
}
