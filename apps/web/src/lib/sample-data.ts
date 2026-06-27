import type { Signal, Competitor } from "@/lib/api";

// Realistic-but-fictional dataset for sample / demo mode (Step 0 cold-start).
// Names are invented (no real brands) so it's unmistakably a demo, while the
// signals carry the full three-layer payload (what changed · why it matters ·
// what to do) so the interface looks alive for a first-time user. Reused by the
// Overview now, and the Signals inbox + competitor detail next.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Demo color identities — so the sample feed avatars match the colored competitors.
const SAMPLE_COMPETITOR_COLORS: Record<string, string> = {
  "sample-northwind": "indigo",
  "sample-beacon": "emerald",
  "sample-lumen": "amber",
};

function signal(s: Partial<Signal> & Pick<Signal, "id" | "severity" | "category" | "insight" | "competitorId" | "competitorName">): Signal {
  return {
    severityOverride: null,
    soWhat: null,
    recommendedAction: null,
    narrative: null,
    isRead: false,
    actionStatus: null,
    actionNote: null,
    createdAt: new Date().toISOString(),
    changeId: `sample-change-${s.id}`,
    sourceType: null,
    feedbackVerdict: null,
    aiConfidence: "high",
    aiFlagged: false,
    aiQualityCheckId: null,
    overlapScore: null,
    relevanceScore: 0.8,
    threatScore: 0.5,
    batchedIntoId: null,
    batchSummary: null,
    batchCount: null,
    filteredReason: null,
    competitorColor: SAMPLE_COMPETITOR_COLORS[s.competitorId] ?? null,
    ...s,
  };
}

function competitor(c: Partial<Competitor> & Pick<Competitor, "id" | "name" | "url" | "category">): Competitor {
  const now = new Date().toISOString();
  return {
    description: null,
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
    createdAt: now,
    updatedAt: now,
    ...c,
  };
}

/** Built fresh each call so the relative timestamps ("2h ago") stay truthful. */
export function getSampleData(): { signals: Signal[]; competitors: Competitor[] } {
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();

  const NORTHWIND = "sample-northwind";
  const BEACON = "sample-beacon";
  const LUMEN = "sample-lumen";
  const COBALT = "sample-cobalt";

  const signals: Signal[] = [
    signal({
      id: "sample-s1",
      severity: "critical",
      category: "pricing",
      competitorId: NORTHWIND,
      competitorName: "Northwind Analytics",
      insight: "Northwind cut its Pro plan 30% to $49/mo and dropped the seat minimum.",
      soWhat: "Undercuts your $69 Pro tier on the exact mid-market deals you're closing this quarter.",
      recommendedAction: "Brief sales on the gap today and weigh a value-add bundle before quarter close.",
      createdAt: at(2 * HOUR),
      overlapScore: 82,
      threatScore: 0.92,
    }),
    signal({
      id: "sample-s2",
      severity: "high",
      category: "product",
      competitorId: BEACON,
      competitorName: "Beacon CRM",
      insight: "Beacon shipped an AI lead-scoring beta to all paid workspaces.",
      soWhat: "Moves them onto your core differentiator — expect it in every competitive bake-off.",
      recommendedAction: "Fast-track the scoring roadmap note and refresh the Beacon battlecard.",
      createdAt: at(5 * HOUR),
      overlapScore: 67,
      threatScore: 0.78,
    }),
    signal({
      id: "sample-s3",
      severity: "medium",
      category: "hiring",
      competitorId: NORTHWIND,
      competitorName: "Northwind Analytics",
      insight: "Northwind opened 4 enterprise AE roles in New York.",
      soWhat: "Signals an upmarket push — they're staffing an enterprise motion.",
      recommendedAction: "Watch for enterprise messaging and pricing changes on their site.",
      isRead: true,
      createdAt: at(14 * HOUR),
      overlapScore: 82,
      threatScore: 0.55,
    }),
    signal({
      id: "sample-s4",
      severity: "high",
      category: "funding",
      competitorId: LUMEN,
      competitorName: "Lumen Billing",
      insight: "Lumen raised a $22M Series B led by Ridgeline Ventures.",
      soWhat: "Fresh capital for GTM — expect louder marketing and a faster release cadence.",
      recommendedAction: "Reassess win/loss against Lumen and tighten your billing differentiators.",
      createdAt: at(DAY),
      overlapScore: 54,
      threatScore: 0.71,
    }),
    signal({
      id: "sample-s5",
      severity: "low",
      category: "reviews",
      competitorId: COBALT,
      competitorName: "Cobalt Security",
      insight: "Three new G2 reviews single out Cobalt's onboarding as fast and well-guided.",
      soWhat: "Onboarding is becoming a strength they'll lean on in deals.",
      recommendedAction: "Capture your own onboarding wins as proof points for sales.",
      isRead: true,
      createdAt: at(2 * DAY),
      overlapScore: 39,
      threatScore: 0.3,
    }),
    signal({
      id: "sample-s6",
      severity: "medium",
      category: "content",
      competitorId: BEACON,
      competitorName: "Beacon CRM",
      insight: "Beacon published a migration guide targeting your product by name.",
      soWhat: "Direct switch-targeting content aimed squarely at your base.",
      recommendedAction: "Ship a counter comparison and tighten retention outreach to at-risk accounts.",
      createdAt: at(2 * DAY + 6 * HOUR),
      overlapScore: 67,
      threatScore: 0.58,
    }),
    signal({
      id: "sample-s7",
      severity: "medium",
      category: "product",
      competitorId: NORTHWIND,
      competitorName: "Northwind Analytics",
      insight: "Northwind added a native Slack integration.",
      soWhat: "Closes a feature checkbox you used to lead on.",
      recommendedAction: "Note parity in the battlecard and reframe around depth, not presence.",
      isRead: true,
      createdAt: at(3 * DAY),
      overlapScore: 82,
      threatScore: 0.45,
    }),
    signal({
      id: "sample-s8",
      severity: "medium",
      category: "pricing",
      competitorId: LUMEN,
      competitorName: "Lumen Billing",
      insight: "Lumen moved Enterprise to annual-only billing.",
      soWhat: "Pushes long commitments and may slow their SMB motion.",
      recommendedAction: "Highlight your monthly flexibility for SMB buyers in head-to-head deals.",
      isRead: true,
      createdAt: at(4 * DAY),
      overlapScore: 54,
      threatScore: 0.4,
    }),
  ];

  const competitors: Competitor[] = [
    competitor({
      id: NORTHWIND,
      name: "Northwind Analytics",
      url: "https://northwind.example.com",
      category: "Analytics",
      color: "indigo",
      overlapScore: 82,
      stats: {
        signals7d: 3,
        signalsPrev: 1,
        lastSignalAt: at(2 * HOUR),
        categoryCounts: { pricing: 1, hiring: 1, product: 1 },
      },
      freshness: { lastScrapedAt: at(2 * HOUR), status: "success" },
    }),
    competitor({
      id: BEACON,
      name: "Beacon CRM",
      url: "https://beacon.example.com",
      category: "CRM",
      color: "emerald",
      overlapScore: 67,
      stats: {
        signals7d: 2,
        signalsPrev: 0,
        lastSignalAt: at(5 * HOUR),
        categoryCounts: { product: 1, content: 1 },
      },
      freshness: { lastScrapedAt: at(5 * HOUR), status: "success" },
    }),
    competitor({
      id: LUMEN,
      name: "Lumen Billing",
      url: "https://lumen.example.com",
      category: "Billing",
      color: "amber",
      overlapScore: 54,
      stats: {
        signals7d: 2,
        signalsPrev: 1,
        lastSignalAt: at(DAY),
        categoryCounts: { funding: 1, pricing: 1 },
      },
      freshness: { lastScrapedAt: at(DAY), status: "success" },
    }),
    competitor({
      id: COBALT,
      name: "Cobalt Security",
      url: "https://cobalt.example.com",
      category: "Security",
      overlapScore: 39,
      stats: {
        signals7d: 1,
        signalsPrev: 0,
        lastSignalAt: at(2 * DAY),
        categoryCounts: { reviews: 1 },
      },
      freshness: { lastScrapedAt: at(2 * DAY), status: "success" },
    }),
  ];

  return { signals, competitors };
}
