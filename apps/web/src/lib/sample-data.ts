import type { Signal, Competitor, SignalDetail } from "@/lib/api";

// Realistic-but-fictional dataset for sample / demo mode (Step 0 cold-start).
// Names are invented (no real brands) so it's unmistakably a demo, while the
// signals carry the full three-layer payload (what changed · why it matters ·
// what to do) so the interface looks alive for a first-time user. Reused by the
// Overview, the Signals inbox + competitor detail, and — via getSampleData() +
// getSampleSignalDetail() — the versioned product screenshots on the landing.
//
// The universe (Vantage, Beacon, Lumen, Cobalt, Meridian) is the SAME fictional
// cast the landing page uses, so the marketing captures and the in-app sample
// mode tell one coherent story.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const VANTAGE = "sample-vantage";
const BEACON = "sample-beacon";
const LUMEN = "sample-lumen";
const COBALT = "sample-cobalt";
const MERIDIAN = "sample-meridian";

// Demo color identities — so the sample feed avatars match the colored competitors.
const SAMPLE_COMPETITOR_COLORS: Record<string, string> = {
  [VANTAGE]: "indigo",
  [BEACON]: "emerald",
  [LUMEN]: "amber",
  [COBALT]: "sky",
  [MERIDIAN]: "rose",
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
    feedbackId: null,
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

  const signals: Signal[] = [
    signal({
      id: "sample-s1",
      severity: "critical",
      category: "pricing",
      competitorId: VANTAGE,
      competitorName: "Vantage",
      insight: "Vantage cut its Pro plan 30% to $49/mo and dropped the seat minimum.",
      soWhat: "Undercuts your $69 Pro tier on the exact mid-market deals you're closing this quarter.",
      recommendedAction: "Brief sales on the gap today and weigh a value-add bundle before quarter close.",
      sourceType: "pricing",
      createdAt: at(2 * HOUR),
      overlapScore: 82,
      threatScore: 0.92,
      relevanceScore: 0.92,
    }),
    signal({
      id: "sample-s2",
      severity: "high",
      category: "product",
      competitorId: BEACON,
      competitorName: "Beacon CRM",
      insight: "Beacon shipped an AI lead-scoring beta to all paid workspaces.",
      soWhat: "Moves them onto your core differentiator. Expect it in every competitive bake-off.",
      recommendedAction: "Fast-track the scoring roadmap note and refresh the Beacon battlecard.",
      sourceType: "changelog",
      createdAt: at(5 * HOUR),
      overlapScore: 67,
      threatScore: 0.78,
    }),
    signal({
      id: "sample-s3",
      severity: "high",
      category: "product",
      competitorId: MERIDIAN,
      competitorName: "Meridian",
      insight: "Meridian rebuilt its homepage around \"agentic workflows\" and dropped the SMB pricing tier from the nav.",
      soWhat: "A positioning pivot upmarket: their messaging now targets the enterprise buyer you sell to.",
      recommendedAction: "Refresh the Meridian comparison page and pre-empt the new narrative in your enterprise deck.",
      sourceType: "homepage",
      createdAt: at(9 * HOUR),
      overlapScore: 71,
      threatScore: 0.74,
      relevanceScore: 0.81,
    }),
    signal({
      id: "sample-s4",
      severity: "medium",
      category: "hiring",
      competitorId: VANTAGE,
      competitorName: "Vantage",
      insight: "Vantage opened 4 enterprise AE roles in New York.",
      soWhat: "Signals an upmarket push: they're staffing an enterprise motion.",
      recommendedAction: "Watch for enterprise messaging and pricing changes on their site.",
      sourceType: "jobs",
      isRead: true,
      createdAt: at(14 * HOUR),
      overlapScore: 82,
      threatScore: 0.55,
    }),
    signal({
      id: "sample-s5",
      severity: "high",
      category: "funding",
      competitorId: LUMEN,
      competitorName: "Lumen Billing",
      insight: "Lumen raised a $22M Series B led by Ridgeline Ventures.",
      soWhat: "Fresh capital for GTM. Expect louder marketing and a faster release cadence.",
      recommendedAction: "Reassess win/loss against Lumen and tighten your billing differentiators.",
      sourceType: "news",
      createdAt: at(DAY),
      overlapScore: 54,
      threatScore: 0.71,
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
      sourceType: "blog",
      createdAt: at(DAY + 4 * HOUR),
      overlapScore: 67,
      threatScore: 0.58,
    }),
    signal({
      id: "sample-s7",
      severity: "medium",
      category: "product",
      competitorId: VANTAGE,
      competitorName: "Vantage",
      insight: "Vantage added a native Slack integration.",
      soWhat: "Closes a feature checkbox you used to lead on.",
      recommendedAction: "Note parity in the battlecard and reframe around depth, not presence.",
      sourceType: "changelog",
      isRead: true,
      createdAt: at(2 * DAY),
      overlapScore: 82,
      threatScore: 0.45,
    }),
    signal({
      id: "sample-s8",
      severity: "low",
      category: "reviews",
      competitorId: COBALT,
      competitorName: "Cobalt Security",
      insight: "Three new App Store reviews single out Cobalt's onboarding as fast and well-guided.",
      soWhat: "Onboarding is becoming a strength they'll lean on in deals.",
      recommendedAction: "Capture your own onboarding wins as proof points for sales.",
      sourceType: "g2_reviews",
      isRead: true,
      createdAt: at(2 * DAY + 6 * HOUR),
      overlapScore: 39,
      threatScore: 0.3,
    }),
    signal({
      id: "sample-s9",
      severity: "medium",
      category: "pricing",
      competitorId: LUMEN,
      competitorName: "Lumen Billing",
      insight: "Lumen moved Enterprise to annual-only billing.",
      soWhat: "Pushes long commitments and may slow their SMB motion.",
      recommendedAction: "Highlight your monthly flexibility for SMB buyers in head-to-head deals.",
      sourceType: "pricing",
      isRead: true,
      createdAt: at(3 * DAY),
      overlapScore: 54,
      threatScore: 0.4,
    }),
    signal({
      id: "sample-s10",
      severity: "medium",
      category: "hiring",
      competitorId: BEACON,
      competitorName: "Beacon CRM",
      insight: "Beacon is hiring a VP of Partnerships and two channel managers.",
      soWhat: "They're building a partner-led motion, with new routes to the accounts you sell to direct.",
      recommendedAction: "Map overlap with your own partners and shore up co-sell relationships.",
      sourceType: "jobs",
      createdAt: at(3 * DAY + 8 * HOUR),
      overlapScore: 67,
      threatScore: 0.42,
    }),
    signal({
      id: "sample-s11",
      severity: "low",
      category: "reviews",
      competitorId: MERIDIAN,
      competitorName: "Meridian",
      insight: "Meridian's Trustpilot score slipped to 4.1 as support-response complaints mount.",
      soWhat: "A soft spot you can lean on: support is a live objection in their deals.",
      recommendedAction: "Add a support-SLA proof point to the Meridian battlecard.",
      sourceType: "capterra_reviews",
      isRead: true,
      createdAt: at(4 * DAY),
      overlapScore: 71,
      threatScore: 0.28,
    }),
    signal({
      id: "sample-s12",
      severity: "medium",
      category: "product",
      competitorId: COBALT,
      competitorName: "Cobalt Security",
      insight: "Cobalt shipped SSO and SCIM to its Team plan and now advertises SOC 2 Type II.",
      soWhat: "Removes a security objection that used to win you enterprise evaluations.",
      recommendedAction: "Confirm your own compliance messaging is at least as prominent on the pricing page.",
      sourceType: "changelog",
      createdAt: at(4 * DAY + 10 * HOUR),
      overlapScore: 39,
      threatScore: 0.5,
    }),
    signal({
      id: "sample-s13",
      severity: "high",
      category: "content",
      competitorId: VANTAGE,
      competitorName: "Vantage",
      insight: "Vantage launched a \"switch and save\" campaign with a 3-month credit for competitors' customers.",
      soWhat: "An aggressive acquisition play aimed directly at your installed base.",
      recommendedAction: "Alert customer success to at-risk renewals and prepare a retention counter-offer.",
      sourceType: "blog",
      createdAt: at(5 * DAY),
      overlapScore: 82,
      threatScore: 0.68,
    }),
  ];

  const competitors: Competitor[] = [
    competitor({
      id: VANTAGE,
      name: "Vantage",
      url: "https://vantage.example.com",
      category: "Analytics",
      color: "indigo",
      overlapScore: 82,
      stats: {
        signals7d: 4,
        signalsPrev: 1,
        unread: 3,
        lastSignalAt: at(2 * HOUR),
        categoryCounts: { pricing: 1, hiring: 1, product: 1, content: 1 },
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
        signals7d: 3,
        signalsPrev: 1,
        unread: 2,
        lastSignalAt: at(5 * HOUR),
        categoryCounts: { product: 1, content: 1, hiring: 1 },
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
        unread: 1,
        lastSignalAt: at(DAY),
        categoryCounts: { funding: 1, pricing: 1 },
      },
      freshness: { lastScrapedAt: at(DAY), status: "success" },
    }),
    competitor({
      id: MERIDIAN,
      name: "Meridian",
      url: "https://meridian.example.com",
      category: "Workflow",
      color: "rose",
      overlapScore: 71,
      stats: {
        signals7d: 2,
        signalsPrev: 0,
        unread: 2,
        lastSignalAt: at(9 * HOUR),
        categoryCounts: { product: 1, reviews: 1 },
      },
      freshness: { lastScrapedAt: at(9 * HOUR), status: "success" },
    }),
    competitor({
      id: COBALT,
      name: "Cobalt Security",
      url: "https://cobalt.example.com",
      category: "Security",
      color: "sky",
      overlapScore: 39,
      stats: {
        signals7d: 2,
        signalsPrev: 0,
        unread: 0,
        lastSignalAt: at(2 * DAY + 6 * HOUR),
        categoryCounts: { reviews: 1, product: 1 },
      },
      freshness: { lastScrapedAt: at(2 * DAY + 6 * HOUR), status: "success" },
    }),
  ];

  return { signals, competitors };
}

// Structured evidence for a handful of sample signals — the WHAT-changed dossier
// the real product fetches from the API (patch-14). Keyed by signal id; only the
// signals that would carry a structured before/after in production have an entry,
// so sample mode shows the evidence panel exactly where the real app would. The
// Vantage pricing cut (sample-s1) is the money shot used on the landing.
const SAMPLE_DETAIL: Record<string, Pick<SignalDetail, "humanChangeBefore" | "humanChangeAfter" | "sourceUrl">> = {
  "sample-s1": {
    humanChangeBefore: "Pro: $69 per user / month, billed annually · 5-seat minimum · advanced analytics add-on sold separately",
    humanChangeAfter: "Pro: $49 per user / month, billed monthly or annually · no seat minimum · advanced analytics now included",
    sourceUrl: "https://vantage.example.com/pricing",
  },
  "sample-s3": {
    humanChangeBefore: "Hero: \"The analytics workspace for growing teams\" · primary CTA \"Start free\" · SMB / Team / Enterprise pricing in the nav",
    humanChangeAfter: "Hero: \"Agentic workflows for the modern enterprise\" · primary CTA \"Talk to sales\" · SMB tier removed, only Team / Enterprise remain",
    sourceUrl: "https://meridian.example.com",
  },
};

/**
 * The user-safe signal detail for a sample signal, shaped exactly like the API's
 * getSignalDetail response so the real <SignalEvidence> renders it unchanged.
 * Returns null for signals with no structured evidence (lexical / jobs / reviews)
 * — same as production, where the SignalCard stands alone.
 */
export function getSampleSignalDetail(signalId: string): SignalDetail | null {
  const { signals } = getSampleData();
  const sig = signals.find((s) => s.id === signalId);
  const evidence = SAMPLE_DETAIL[signalId];
  if (!sig || !evidence) return null;
  return {
    id: sig.id,
    insight: sig.insight,
    severity: sig.severity,
    category: sig.category,
    detectedAt: sig.createdAt,
    humanChangeBefore: evidence.humanChangeBefore,
    humanChangeAfter: evidence.humanChangeAfter,
    narrative: null,
    changes: [],
    diffText: null,
    materiality: null,
    engagement: null,
    facts: null,
    relevanceScore: sig.relevanceScore ?? null,
    sourceType: sig.sourceType,
    sourceUrl: evidence.sourceUrl,
    competitor: { id: sig.competitorId, name: sig.competitorName },
  };
}
