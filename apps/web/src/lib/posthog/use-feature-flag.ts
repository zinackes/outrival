"use client";

import { useEffect, useState } from "react";
import { withPosthog } from "./lazy";

/**
 * A PostHog feature flag, read off the lazily-loaded client.
 *
 * Replaces `posthog-js/react`'s `useFeatureFlagEnabled`, whose context provider was
 * the reason the SDK sat in the first-load JS of every page. Semantics are kept
 * where they matter: the value starts `false`, so a kill switch reads as OFF until
 * PostHog says otherwise. That is the same fail-open behaviour as before, where the
 * hook returned `undefined` until the flags arrived.
 */
export function useFeatureFlag(flag: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let live = true;
    let unsubscribe: (() => void) | undefined;
    withPosthog((p) => {
      if (!live) return;
      setEnabled(Boolean(p.isFeatureEnabled(flag)));
      // Flags can land after init, so the first read is not necessarily the last.
      const off = p.onFeatureFlags(() => {
        if (live) setEnabled(Boolean(p.isFeatureEnabled(flag)));
      });
      unsubscribe = typeof off === "function" ? off : undefined;
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [flag]);

  return enabled;
}
