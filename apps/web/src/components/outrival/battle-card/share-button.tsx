"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { ShareNetworkIcon, CheckIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

// Share a battle card as a public read-only page (OUT-193, on the Lever 8 infra).
//
// The link names the (product, competitor) couple, not the card row it was minted
// from: a card the nightly auto-refresh rewrites keeps the same URL, so a link sent
// to a rep in March still opens the current card in June. Create-or-return, so
// clicking twice hands back one URL instead of two live tokens.
export function ShareBattleCardButton({
  competitorId,
  productId,
  disabled,
}: {
  competitorId: string;
  productId?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const { url } = await api.createBattleCardShareLink(competitorId, productId);
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Battle card link copied", {
        description:
          "Anyone with the link sees the current card, refresh included. Revoke it in Settings → Data.",
      });
    } catch {
      toast.error("Couldn’t create the share link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={share} disabled={busy || disabled}>
      {copied ? <CheckIcon size={16} /> : <ShareNetworkIcon size={16} />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
