"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { getConsent } from "../consent";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || key.includes("REPLACE_ME")) return;

    posthog.init(key, {
      // Same-origin reverse proxy (see rewrites in next.config.ts) so ad-blockers
      // can't blacklist the ingest host by domain. ui_host keeps "Open in PostHog"
      // links pointing at the real EU app.
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false,
      autocapture: true,
      opt_out_capturing_by_default: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "[data-ph-mask]",
      },
    });

    if (getConsent() === "granted") {
      posthog.opt_in_capturing();
    }
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
