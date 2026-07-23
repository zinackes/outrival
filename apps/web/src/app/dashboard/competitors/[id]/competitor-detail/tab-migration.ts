import type { TabKey } from "./types";

export const TAB_KEYS: readonly TabKey[] = [
  "overview",
  "activity",
  "pricing",
  "hiring",
  "reviews",
  "product",
] as const;

/**
 * Where a `?tab=` value that no longer exists now lives. These links are not just
 * in our own markup — generate-battle-card writes `?tab=battlecard` into
 * notifications.link_url, so rows already in the database point here. Dropping a
 * key without a mapping would 404 a notification a user is clicking today.
 */
const RETIRED_TABS: Record<string, TabKey | "battle-card"> = {
  // Content was absorbed by the wider Product & Positioning feed.
  content: "product",
  // Custom pages: their changes flow into the same feed; configuring them moved
  // to the Sources page.
  custom: "product",
  // Tech stack became a card on Overview that opens a detail sheet.
  techstack: "overview",
  // Battle cards became a page of their own, reached from the header.
  battlecard: "battle-card",
};

export type TabTarget =
  | { kind: "tab"; tab: TabKey }
  /** Not a tab any more — navigate to this sub-route of the competitor page. */
  | { kind: "route"; segment: "battle-card" };

/**
 * Resolve a raw `?tab=` value to where it should land today. Returns null for an
 * absent or unrecognised value, so the caller keeps its default tab (an unknown
 * key must never blank the page).
 */
export function resolveTabParam(raw: string | null | undefined): TabTarget | null {
  if (!raw) return null;
  if ((TAB_KEYS as readonly string[]).includes(raw)) return { kind: "tab", tab: raw as TabKey };
  const moved = RETIRED_TABS[raw];
  if (!moved) return null;
  return moved === "battle-card"
    ? { kind: "route", segment: "battle-card" }
    : { kind: "tab", tab: moved };
}
