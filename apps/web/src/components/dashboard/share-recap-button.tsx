"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { toastApiError } from "@/lib/error-helpers";
import { ShareNetworkIcon, CheckIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

// Share the monthly recap as a public "Wrapped" link (Lever 9, on the L8 infra).
// Create-or-return is idempotent per (org, month); copies the link.
export function ShareRecapButton({ month }: { month: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const { url } = await api.createRecapShareLink(month);
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Recap link copied", {
        description:
          "Anyone with the link can view your recap. Revoke it in Settings → Data; it stops opening within 5 minutes.",
      });
    } catch (e) {
      toastApiError(e, { title: "Couldn’t create the share link" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={share} disabled={busy}>
      {copied ? <CheckIcon className="size-4" /> : <ShareNetworkIcon className="size-4" />}
      {copied ? "Link copied" : "Share recap"}
    </Button>
  );
}
