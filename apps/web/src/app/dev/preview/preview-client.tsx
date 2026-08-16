"use client";

import { useEffect } from "react";
import { ProductScopeProvider } from "@/components/dashboard/product-scope-provider";
import { AskContextProvider } from "@/components/dashboard/ask-context";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OverviewView } from "@/components/dashboard/overview";
import { SignalCard } from "@/components/dashboard/signal-card";
import { SignalEvidence } from "@/components/outrival/signal-evidence";
import { getSampleData, getSampleSignalDetail } from "@/lib/sample-data";
import { useSampleMode } from "@/hooks/use-sample-mode";

// The capture script also sets this via addInitScript before load (no flash); the
// effect here is the fallback so the route is usable by hand in a browser too.
function ForceSample({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useSampleMode();
  useEffect(() => {
    if (!on) setOn(true);
  }, [on, setOn]);
  return <>{children}</>;
}

// (a) The real Overview, populated by sample data: the lead signal + its pulse rail,
// the movers band, and the decision queue.
function OverviewShot() {
  return (
    <>
      {/* The sample-data banner is app chrome, not part of the product story we're
          selling — hide it so the marketing capture is clean. */}
      <style>{`[data-sample-banner]{display:none!important}`}</style>
      <div
        data-shot="overview"
        className="mx-auto w-full max-w-[1120px] px-8 py-8"
      >
        <OverviewView />
      </div>
    </>
  );
}

// (b) The money shot — a signal's detail: the SignalCard (what changed · why it
// matters · what to do) plus the before/after evidence dossier for the Vantage
// pricing cut. Same components the app renders; fed the sample dossier so no backend
// is needed.
function SignalShot() {
  const { signals } = getSampleData();
  const sig = signals.find((s) => s.id === "sample-s1");
  const detail = getSampleSignalDetail("sample-s1");
  if (!sig) return null;
  return (
    <div data-shot="signal" className="mx-auto w-full max-w-[860px] px-8 py-8">
      <div className="space-y-4">
        <SignalCard signal={sig} interactive={false} />
        {detail && <SignalEvidence signalId={sig.id} detail={detail} />}
      </div>
    </div>
  );
}

// (c) The whole app, once: the real sidebar and topbar around the real
// Overview. The two crops above answer "what does a signal look like"; this one
// answers "what am I buying", which is the question the comparison pages ask.
// DashboardShell supplies its own providers, so it is NOT wrapped in the ones
// the other two shots need.
function AppShot() {
  return (
    <>
      {/* Sample banner and the feedback launcher are app chrome, not product. */}
      <style>{`[data-sample-banner]{display:none!important}`}</style>
      <div data-shot="app">
        <DashboardShell
          user={{ name: "Mathys", email: "hello@outrival.app" }}
          org={{ plan: "Pro", competitorsUsed: 6 }}
        >
          <OverviewView />
        </DashboardShell>
      </div>
    </>
  );
}

export function PreviewClient({
  shot,
}: {
  shot: "overview" | "signal" | "app";
}) {
  // The two crops render bare dashboard components, which reach for the same
  // providers the app supplies (product scope, ask context) on top of the
  // query/tooltip/toaster from the /dev layout. Wrap them so e.g. SignalCard's
  // product chips (useProductScope) don't throw. The app shot brings the real
  // shell, which already carries both.
  if (shot === "app") {
    return (
      <ForceSample>
        <AppShot />
      </ForceSample>
    );
  }
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <ForceSample>
        <ProductScopeProvider initial={null}>
          <AskContextProvider>
            {shot === "signal" ? <SignalShot /> : <OverviewShot />}
          </AskContextProvider>
        </ProductScopeProvider>
      </ForceSample>
    </div>
  );
}
