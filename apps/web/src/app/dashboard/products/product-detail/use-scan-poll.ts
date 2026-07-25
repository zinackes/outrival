"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { myProductQuery } from "@/lib/queries";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import type { MyProduct, SelfProfile } from "@/lib/api";

/** Whether any profile field (auto-detected or user-entered) has landed. A scrape can
 * succeed while the downstream AI extraction (extract-self-profile) returns nothing —
 * a "scan complete" must not claim the profile is up to date when it's still empty. */
export function hasProfileContent(profile: SelfProfile | undefined): boolean {
  if (!profile) return false;
  if ([profile.category, profile.audience, profile.valueProp].some((f) => (f?.value ?? "").trim().length > 0))
    return true;
  return [profile.features, profile.techStack].some((f) => (f?.value?.length ?? 0) > 0);
}

/**
 * While a scan is in progress, poll until it settles, then refresh + toast the
 * outcome, so a re-scan visibly finishes instead of leaving the user guessing.
 */
export function useScanPoll({
  product,
  productId,
  load,
}: {
  product: MyProduct | null | undefined;
  productId?: string;
  load: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const wasScanning = useRef(false);

  useEffect(() => {
    const scanning = product?.scanning ?? false;
    if (scanning) {
      wasScanning.current = true;
      const t = setInterval(() => load(), 4000);
      return () => clearInterval(t);
    }
    if (!wasScanning.current) return;
    wasScanning.current = false;

    if (product?.scanError) {
      toast.error("Scan failed", {
        description: friendlyScrapeError(product.scanError, product.scanErrorSource ?? undefined),
      });
      return;
    }

    // Fast path: the profile already has content (re-scan of an analysed product) →
    // confirm immediately; still poll a few cycles to fold in any refreshed fields.
    if (hasProfileContent(product?.profile)) {
      toast.success("Scan complete", { description: "Your profile is up to date." });
      let n = 0;
      const t = setInterval(() => {
        void load();
        if (++n >= 5) clearInterval(t);
      }, 4000);
      return () => clearInterval(t);
    }

    // Slow path: the profile is still empty at settle time. It may be in-flight — the
    // fields are written by a downstream AI task (extract-self-profile) that lands a
    // few seconds AFTER scrapeStartedAt clears — or the extraction may have silently
    // failed (parse miss → empty profile). Poll for the late write, then tell the
    // truth instead of claiming "up to date" over a blank profile.
    const toastId = toast.loading("Scan complete, reading your profile…");
    let n = 0;
    const t = setInterval(async () => {
      await load();
      const latest = queryClient.getQueryData<MyProduct>(myProductQuery(productId).queryKey);
      const populated = hasProfileContent(latest?.profile);
      if (!populated && ++n < 6) return;
      clearInterval(t);
      if (populated) {
        toast.success("Scan complete", { id: toastId, description: "Your profile is up to date." });
      } else {
        toast.warning("Scan complete, couldn't read your profile", {
          id: toastId,
          description:
            "We scanned your site but couldn't extract the profile automatically. Add it manually, or try another re-scan.",
        });
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the effect keys on the
    // scan transition only; adding load/queryClient would restart the poll on every
    // render (the behaviour this was extracted from, unchanged).
  }, [product?.scanning, product?.scanError]);
}
