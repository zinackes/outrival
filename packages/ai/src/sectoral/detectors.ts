import type {
  CompetitorSectoralData,
  DetectedPattern,
  CompetitorRef,
} from "./types";

// Pure statistical detectors over an org's OWN competitors (patch-13). No AI, no I/O.
// The job assembles the aggregated data and filters the output by confidence; these
// functions only describe what the numbers say.

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function ref(c: CompetitorSectoralData): CompetitorRef {
  return { id: c.id, name: c.name };
}

function sinceDate(periodDays: number): Date {
  return new Date(Date.now() - periodDays * 86_400_000);
}

// Word-token match so short keywords ("ai", "ml") don't match inside other words
// ("email", "html"). Multi-word keywords fall back to substring on normalized text.
function textMatchesKeyword(normalized: string, tokens: Set<string>, keyword: string): boolean {
  return keyword.includes(" ") ? normalized.includes(keyword) : tokens.has(keyword);
}

// ---------------------------------------------------------------------------
// 1. Feature trends — themes shared across competitors' recent product signals.
// Source: classified `product` signals (already significant). Themes via keywords.
// ---------------------------------------------------------------------------

export const FEATURE_THEMES: Record<string, string[]> = {
  AI: ["ai", "gpt", "llm", "genai", "copilot", "agent", "agents", "assistant", "model", "models", "artificial intelligence", "machine learning", "generative"],
  integrations: ["integration", "integrations", "connector", "connectors", "api", "webhook", "webhooks", "zapier", "sync"],
  mobile: ["mobile", "ios", "android", "app store", "play store"],
  security: ["sso", "saml", "scim", "rbac", "encryption", "compliance", "gdpr", "hipaa", "soc 2", "audit log", "audit logs"],
  analytics: ["analytics", "dashboard", "dashboards", "reporting", "reports", "metrics", "insights"],
  collaboration: ["collaboration", "collaborate", "comments", "workspace", "workspaces", "real time", "realtime", "multiplayer"],
  automation: ["automation", "automations", "automate", "workflow", "workflows", "no code", "no-code"],
};

export function detectFeatureTrends(
  competitors: CompetitorSectoralData[],
  periodDays: number,
): DetectedPattern[] {
  const total = competitors.length;
  if (total === 0) return [];
  const since = sinceDate(periodDays);

  // theme -> { competitor, matched insight } for competitors touching that theme.
  const byTheme = new Map<string, Array<{ competitor: CompetitorSectoralData; sample: string }>>();

  for (const c of competitors) {
    const recent = c.productSignals.filter((s) => s.createdAt >= since);
    if (recent.length === 0) continue;

    const themesHit = new Map<string, string>(); // theme -> first matching insight
    for (const s of recent) {
      const normalized = `${s.insight} ${s.soWhat ?? ""}`.toLowerCase();
      const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
      for (const [theme, keywords] of Object.entries(FEATURE_THEMES)) {
        if (themesHit.has(theme)) continue;
        if (keywords.some((k) => textMatchesKeyword(normalized, tokens, k))) {
          themesHit.set(theme, s.insight);
        }
      }
    }
    for (const [theme, sample] of themesHit) {
      const arr = byTheme.get(theme) ?? [];
      arr.push({ competitor: c, sample });
      byTheme.set(theme, arr);
    }
  }

  const patterns: DetectedPattern[] = [];
  for (const [theme, hits] of byTheme) {
    const count = hits.length;
    const share = count / total;
    // A theme is a candidate at ≥40% of competitors AND ≥2 in absolute terms.
    if (share < 0.4 || count < 2) continue;
    patterns.push({
      category: "feature_trend",
      rawSignal: `${count} of ${total} competitors shipped ${theme}-related product changes in the last ${periodDays} days.`,
      evidence: {
        competitors: hits.map((h) => ref(h.competitor)),
        dataPoints: hits.map((h) => ({ competitor: h.competitor.name, insight: h.sample })),
        metric: `feature_theme:${theme}`,
        value: `${count}/${total}`,
      },
      // Confidence = share of competitors moving on the theme.
      confidence: clamp01(share),
    });
  }
  return patterns;
}

// ---------------------------------------------------------------------------
// 2. Hiring trends — role categories several competitors are hiring for.
// Source: job_postings, bucketed by department or title keywords.
// ---------------------------------------------------------------------------

const ROLE_CATEGORIES: Record<string, string[]> = {
  sales: ["sales", "account executive", "account exec", "ae", "sdr", "bdr", "revenue", "go to market", "gtm"],
  "ai/ml": ["machine learning", "ml engineer", "ai engineer", "data scientist", "research scientist", "applied scientist", "llm"],
  engineering: ["engineer", "engineering", "developer", "software", "backend", "frontend", "full stack", "fullstack", "devops", "platform", "infrastructure"],
  marketing: ["marketing", "growth", "demand generation", "content", "brand", "seo"],
  product: ["product manager", "product management", "pm", "product lead", "product owner"],
  design: ["design", "designer", "ux", "ui"],
  support: ["support", "customer success", "csm", "onboarding specialist"],
};

function classifyRole(title: string, department: string | null): string | null {
  const hay = `${department ?? ""} ${title}`.toLowerCase();
  const tokens = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  for (const [category, keywords] of Object.entries(ROLE_CATEGORIES)) {
    if (keywords.some((k) => (k.includes(" ") ? hay.includes(k) : tokens.has(k)))) {
      return category;
    }
  }
  return null;
}

export function detectHiringTrends(
  competitors: CompetitorSectoralData[],
  periodDays: number,
): DetectedPattern[] {
  const total = competitors.length;
  if (total === 0) return [];
  const since = sinceDate(periodDays);

  const byCategory = new Map<string, Array<{ competitor: CompetitorSectoralData; titles: string[] }>>();

  for (const c of competitors) {
    const recent = c.jobs.filter((j) => j.detectedAt >= since);
    if (recent.length === 0) continue;
    const catTitles = new Map<string, string[]>();
    for (const j of recent) {
      const cat = classifyRole(j.title, j.department);
      if (!cat) continue;
      const titles = catTitles.get(cat) ?? [];
      titles.push(j.title);
      catTitles.set(cat, titles);
    }
    for (const [cat, titles] of catTitles) {
      const arr = byCategory.get(cat) ?? [];
      arr.push({ competitor: c, titles });
      byCategory.set(cat, arr);
    }
  }

  const patterns: DetectedPattern[] = [];
  for (const [category, hits] of byCategory) {
    const count = hits.length;
    // A hiring wave needs ≥3 distinct competitors hiring the same role category.
    if (count < 3) continue;
    patterns.push({
      category: "hiring_trend",
      rawSignal: `${count} of ${total} competitors are actively hiring for ${category} roles.`,
      evidence: {
        competitors: hits.map((h) => ref(h.competitor)),
        dataPoints: hits.map((h) => ({ competitor: h.competitor.name, roles: h.titles.slice(0, 5) })),
        metric: `hiring_role:${category}`,
        value: `${count}/${total}`,
      },
      // Confidence = share of competitors hiring that category.
      confidence: clamp01(count / total),
    });
  }
  return patterns;
}

// ---------------------------------------------------------------------------
// 3. Pricing trends — sector-wide drift in price over the window.
// Source: pricing_history (per competitor, mean price start vs end).
// ---------------------------------------------------------------------------

export function detectPricingTrends(
  competitors: CompetitorSectoralData[],
  periodDays: number,
): DetectedPattern[] {
  const since = sinceDate(periodDays);

  const perCompetitor: Array<{ competitor: CompetitorSectoralData; pct: number }> = [];
  for (const c of competitors) {
    const points = c.pricePoints
      .filter((p) => p.recordedAt >= since && p.price > 0)
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    if (points.length < 2) continue;

    const firstTs = points[0]!.recordedAt.getTime();
    const lastTs = points[points.length - 1]!.recordedAt.getTime();
    if (firstTs === lastTs) continue; // single scrape → no trajectory

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const startMean = mean(points.filter((p) => p.recordedAt.getTime() === firstTs).map((p) => p.price));
    const endMean = mean(points.filter((p) => p.recordedAt.getTime() === lastTs).map((p) => p.price));
    if (startMean <= 0) continue;

    perCompetitor.push({ competitor: c, pct: (endMean - startMean) / startMean });
  }

  // Need enough competitors with a real trajectory to call it a "sector" trend.
  if (perCompetitor.length < 3) return [];

  const medianPct = median(perCompetitor.map((p) => p.pct));
  if (Math.abs(medianPct) <= 0.1) return [];

  const pctLabel = `${(medianPct * 100).toFixed(0)}%`;
  const direction = medianPct < 0 ? "dropped" : "rose";
  return [
    {
      category: "pricing_trend",
      rawSignal: `Median pricing across ${perCompetitor.length} competitors ${direction} by ${Math.abs(medianPct * 100).toFixed(0)}% over the last ${periodDays} days.`,
      evidence: {
        competitors: perCompetitor.map((p) => ref(p.competitor)),
        dataPoints: perCompetitor.map((p) => ({
          competitor: p.competitor.name,
          changePct: Number((p.pct * 100).toFixed(1)),
        })),
        metric: "pricing_median_change",
        value: pctLabel,
      },
      // Confidence scales with magnitude: 12% → 0.6, 20%+ → 1.0.
      confidence: clamp01(Math.abs(medianPct) / 0.2),
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. Positioning shifts — competitors moving from public pricing to gated/demo.
// Source: pricing_history status timeline (patch-11 taxonomy).
// ---------------------------------------------------------------------------

const GATED_STATUSES = new Set(["gated_demo", "contact_sales", "gated"]);
const OPEN_STATUSES = new Set(["public", "usage_based", "freemium", "free"]);

export function detectPositioningShifts(
  competitors: CompetitorSectoralData[],
  periodDays: number,
): DetectedPattern[] {
  const since = sinceDate(periodDays);

  const shifted: Array<{ competitor: CompetitorSectoralData; from: string; to: string }> = [];
  for (const c of competitors) {
    const timeline = c.statusTimeline
      .filter((p) => p.recordedAt >= since && p.status)
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    if (timeline.length < 2) continue;

    const first = timeline[0]!.status;
    const last = timeline[timeline.length - 1]!.status;
    // A transition from an open posture to a gated one within the window.
    if (OPEN_STATUSES.has(first) && GATED_STATUSES.has(last)) {
      shifted.push({ competitor: c, from: first, to: last });
    }
  }

  // Two competitors gating their pricing is enough to read as enterprise consolidation.
  if (shifted.length < 2) return [];

  const total = competitors.length;
  return [
    {
      category: "positioning_shift",
      rawSignal: `${shifted.length} of ${total} competitors moved from open pricing to gated/contact-sales pricing in the last ${periodDays} days.`,
      evidence: {
        competitors: shifted.map((s) => ref(s.competitor)),
        dataPoints: shifted.map((s) => ({ competitor: s.competitor.name, from: s.from, to: s.to })),
        metric: "pricing_status_gating",
        value: `${shifted.length}/${total}`,
      },
      // 2 transitions → 0.6 (publish threshold), 4+ → 1.0.
      confidence: clamp01(0.4 + 0.2 * (shifted.length - 1)),
    },
  ];
}
