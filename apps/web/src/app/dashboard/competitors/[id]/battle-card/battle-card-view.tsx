"use client";

import { BattleCardPage } from "@/components/outrival/battle-card/battle-card-page";

/**
 * Battle cards, on their own page rather than a tab. A card is an artefact you go
 * and produce (and export as a PDF), not a lens you flip between — and its daily
 * generation cap is enforced where it always was, inside the page component at
 * generate time, so the surface moving changes no entitlement.
 *
 * The page head lives with the card because the actions (edit, regenerate, download)
 * and the freshness it states are the card's own state.
 */
export function BattleCardPageView({ id }: { id: string }) {
  return <BattleCardPage competitorId={id} />;
}
