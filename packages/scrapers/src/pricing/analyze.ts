import * as cheerio from "cheerio";
import type { PricingStatus } from "@outrival/shared";
import { detectPricingSignals, type PricingSignals } from "./signals";
import { determineStatus } from "./determine-status";

export interface PricingAnalysis {
  status: PricingStatus;
  promotional: boolean;
  demoUrl: string | null; // booking/contact link, only for gated_demo
  note: string | null; // short English explanation for the UI
  reasoning: string; // debug, for logs / findings.md
  signals: PricingSignals;
}

/**
 * Pure HTML → pricing analysis. The scraper fetches the page; the worker calls
 * this to turn it into a status + metadata. Kept out of the scraper itself so
 * it has no crawlee/playwright dependency and stays unit-testable.
 */
export function analyzePricingHtml(html: string, baseUrl?: string): PricingAnalysis {
  const signals = detectPricingSignals(html);
  const decision = determineStatus(signals);
  const demoUrl = decision.status === "gated_demo" ? extractDemoUrl(html, baseUrl) : null;
  return {
    status: decision.status,
    promotional: signals.hasPromotionalText,
    demoUrl,
    note: buildNote(decision.status),
    reasoning: decision.reasoning,
    signals,
  };
}

// English, factual notes — surfaced verbatim in the competitor pricing card.
const NOTES: Record<PricingStatus, string | null> = {
  public: null,
  public_partial: "Lower tiers are public; the top tier is sales-gated.",
  gated_demo: "No public prices — book a demo or contact sales to get pricing.",
  gated_signup: "Pricing is hidden behind an account signup.",
  dynamic: "Usage-based pricing (interactive calculator).",
  unknown: "Automatic pricing detection was inconclusive.",
};

function buildNote(status: PricingStatus): string | null {
  return NOTES[status];
}

const DEMO_HREF = /(demo|contact|sales|calendly|book|request|quote)/i;
const DEMO_TEXT = /\b(book|get|schedule|request)\s+(a\s+)?demo\b|\bcontact\s+(sales|us)\b|\btalk\s+to\s+sales\b/i;

/** Best-effort booking/contact link from the gated CTA. */
export function extractDemoUrl(html: string, baseUrl?: string): string | null {
  const $ = cheerio.load(html);
  let href: string | null = null;
  // Prefer a link whose visible text is the gated CTA, then any demo-ish href.
  $("a[href]").each((_, el) => {
    if (href) return;
    const h = $(el).attr("href");
    if (!h) return;
    if (DEMO_TEXT.test($(el).text()) || DEMO_HREF.test(h)) href = h;
  });
  if (!href) return null;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}
