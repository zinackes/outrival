import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { adjustCompetitorUnread, competitorsQuery } from "@/lib/queries";
import type { Competitor } from "@/lib/api";

// The sidebar badges each competitor with an unread count it reads off the
// ["competitors"] cache, refreshed by a 60s poll. Reading one signal has to move
// that count immediately, so the arithmetic — and which cache entries it reaches —
// is what this locks: the scoped and unscoped roster keys are separate entries,
// and the sidebar observes whichever matches the active product.

function competitor(id: string, unread: number): Competitor {
  return {
    id,
    name: id,
    url: `https://${id}.com`,
    description: null,
    category: null,
    color: null,
    overlapScore: null,
    aiSummary: null,
    aiSummaryUpdatedAt: null,
    metadata: null,
    pricingStatus: null,
    pricingObservedRegion: null,
    pricingPromotional: false,
    pricingDemoUrl: null,
    pricingNote: null,
    pricingManualOverride: false,
    monitoringPaused: false,
    alertsMuted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stats: {
      signals7d: 0,
      signalsPrev: 0,
      unread,
      lastSignalAt: null,
      categoryCounts: {},
    },
  };
}

function unreadOf(qc: QueryClient, productId: string | undefined, id: string) {
  const roster = qc.getQueryData<Competitor[]>(competitorsQuery(productId).queryKey);
  return roster?.find((c) => c.id === id)?.stats?.unread;
}

describe("adjustCompetitorUnread", () => {
  test("moves only the named competitor's count", () => {
    const qc = new QueryClient();
    qc.setQueryData(competitorsQuery().queryKey, [competitor("acme", 3), competitor("globex", 5)]);

    adjustCompetitorUnread(qc, "acme", -1);

    expect(unreadOf(qc, undefined, "acme")).toBe(2);
    expect(unreadOf(qc, undefined, "globex")).toBe(5);
  });

  test("marking unread again puts the count back", () => {
    const qc = new QueryClient();
    qc.setQueryData(competitorsQuery().queryKey, [competitor("acme", 3)]);

    adjustCompetitorUnread(qc, "acme", -1);
    adjustCompetitorUnread(qc, "acme", 1);

    expect(unreadOf(qc, undefined, "acme")).toBe(3);
  });

  test("patches the product-scoped roster too", () => {
    const qc = new QueryClient();
    qc.setQueryData(competitorsQuery().queryKey, [competitor("acme", 3)]);
    qc.setQueryData(competitorsQuery("prod-1").queryKey, [competitor("acme", 3)]);

    adjustCompetitorUnread(qc, "acme", -1);

    expect(unreadOf(qc, undefined, "acme")).toBe(2);
    expect(unreadOf(qc, "prod-1", "acme")).toBe(2);
  });

  test("never goes negative when the cached count is already stale", () => {
    const qc = new QueryClient();
    qc.setQueryData(competitorsQuery().queryKey, [competitor("acme", 0)]);

    adjustCompetitorUnread(qc, "acme", -1);

    expect(unreadOf(qc, undefined, "acme")).toBe(0);
  });

  test("leaves a roster with no stats block untouched", () => {
    const qc = new QueryClient();
    const bare = { ...competitor("acme", 0), stats: undefined };
    qc.setQueryData(competitorsQuery().queryKey, [bare]);

    adjustCompetitorUnread(qc, "acme", -1);

    expect(unreadOf(qc, undefined, "acme")).toBeUndefined();
  });
});
