"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Share2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

// "Share snapshot" (Lever 8) — the PLG moment: turn the day-0 landscape into a public,
// revocable "Competitive Snapshot Report" link and copy it. Create-or-return is
// idempotent server-side, so re-clicking hands back the same link. Manage/revoke lives
// in Settings → Data.
export function ShareSnapshotButton({ productId }: { productId?: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const { url } = await api.createShareLink(productId);
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Snapshot link copied", {
        description: "Anyone with the link can view this report. Revoke it in Settings → Data.",
      });
    } catch {
      toast.error("Couldn’t create the share link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={share} disabled={busy}>
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Link copied" : "Share snapshot"}
    </Button>
  );
}
