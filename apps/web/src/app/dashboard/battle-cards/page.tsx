import { BattleCardsView } from "./battle-cards-view";
import { getBattleCardsData } from "@/lib/api-server";

export default async function BattleCardsPage() {
  // Best-effort server prefetch; null falls back to the client fetch inside
  // BattleCardsView.
  const initialCards = await getBattleCardsData();
  return <BattleCardsView initialCards={initialCards} />;
}
