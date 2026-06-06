// Sectoral analysis (patch-13). Meso-level patterns detected by crossing an org's
// OWN competitors. These types are shared by the pure detectors and the AI formulation.

export type SectoralCategory =
  | "feature_trend"
  | "hiring_trend"
  | "pricing_trend"
  | "positioning_shift"
  | "category_emergence";

export interface CompetitorRef {
  id: string;
  name: string;
}

// Traceability payload kept verbatim with the signal so the UI can show what
// produced it. No AI invention is possible — the formulation only rephrases this.
export interface PatternEvidence {
  competitors: CompetitorRef[];
  dataPoints: unknown[];
  metric: string;
  value: number | string;
}

export interface DetectedPattern {
  category: SectoralCategory;
  // Plain-language description handed to the AI for formulation.
  rawSignal: string;
  evidence: PatternEvidence;
  // 0-1. The job publishes only patterns above SECTORAL_MIN_CONFIDENCE.
  confidence: number;
}

// --- Aggregated per-competitor inputs (assembled by the job, fed to pure detectors) ---

export interface ProductSignalInput {
  insight: string;
  soWhat: string | null;
  createdAt: Date;
}

export interface JobInput {
  title: string;
  department: string | null;
  detectedAt: Date;
}

// One pricing observation (a plan's price at a scrape time) from pricing_history.
export interface PricePointInput {
  planName: string;
  price: number;
  recordedAt: Date;
}

// A pricing-status observation (patch-11 taxonomy) at a scrape time, from pricing_history.
export interface PricingStatusPointInput {
  status: string;
  recordedAt: Date;
}

export interface CompetitorSectoralData {
  id: string;
  name: string;
  productSignals: ProductSignalInput[];
  jobs: JobInput[];
  pricePoints: PricePointInput[];
  statusTimeline: PricingStatusPointInput[];
}
