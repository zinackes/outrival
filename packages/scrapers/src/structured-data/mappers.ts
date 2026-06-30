import {
  extractJsonLd,
  findByType,
  asText,
  asPrice,
  type JsonLdNode,
} from "./json-ld";

/**
 * Per-source structured-first mappers (patch-30). Each turns schema.org JSON-LD
 * into the SAME shape its AI extractor produces, so the worker validates them with
 * the exact same Zod schema (PricingSchema / JobsSchema). Return null when the
 * markup isn't present or yields nothing usable → the pipeline falls through to the
 * cached parser, then AI self-heal. Shapes are intentionally plain (structurally
 * compatible with @outrival/ai types) — @outrival/scrapers must stay an AI-free leaf.
 */

// ── Pricing ──────────────────────────────────────────────────────────────────

export interface StructuredPricingPlan {
  plan_name: string;
  price: number | null;
  currency: string;
  billing_period: "monthly" | "yearly" | "one_time" | "custom";
}
export interface StructuredPricing {
  plans: StructuredPricingPlan[];
}

/** ISO-8601 duration / free-text → our billing_period enum. */
function billingPeriod(spec: JsonLdNode | null, priceIsNull: boolean): StructuredPricingPlan["billing_period"] {
  const raw =
    asText(spec?.["billingDuration"]) ??
    asText(spec?.["billingPeriod"]) ??
    asText(spec?.["unitCode"]) ??
    asText(spec?.["unitText"]) ??
    "";
  const s = raw.toLowerCase();
  if (/p1y|year|ann|p12m/.test(s)) return "yearly";
  if (/p1m|mon|p30d/.test(s)) return "monthly";
  // No period info: a real price defaults to monthly (the SaaS norm); a quote-based
  // tier with no price is "custom".
  return priceIsNull ? "custom" : "monthly";
}

function offerToPlan(offer: JsonLdNode, fallbackName: string | null): StructuredPricingPlan | null {
  const spec = (offer["priceSpecification"] as JsonLdNode | undefined) ?? null;
  const price = asPrice(offer["price"]) ?? asPrice(spec?.["price"]);
  const currency =
    asText(offer["priceCurrency"]) ?? asText(spec?.["priceCurrency"]) ?? "USD";
  // A tier's own name/category wins. With neither, a $0 offer is the Free tier;
  // only then fall back to the product name — and the caller passes it as null for
  // multi-tier products, where reusing the product name would mislabel a nameless
  // tier (typically the free one) with the competitor's name.
  const name =
    asText(offer["name"]) ??
    asText(offer["category"]) ??
    (price === 0 ? "Free" : fallbackName);
  if (!name) return null;
  return {
    plan_name: name,
    price, // null is valid (quote-based / "Contact sales")
    currency,
    billing_period: billingPeriod(spec, price === null),
  };
}

/** Collect Offer nodes from a Product / SoftwareApplication / Service `offers`. */
function offersOf(node: JsonLdNode): JsonLdNode[] {
  const offers = node["offers"];
  const list: JsonLdNode[] = [];
  const visit = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(visit);
    if (!o || typeof o !== "object") return;
    const obj = o as JsonLdNode;
    // AggregateOffer wraps the real tiers in its own `offers` — recurse into the
    // container, never treat the wrapper itself as a tier.
    if (obj["offers"]) return visit(obj["offers"]);
    // A leaf offer: a price, a price spec, or just a named quote-based tier
    // ("Enterprise" / "Contact sales" carry a name but no public price).
    if (
      obj["price"] != null ||
      obj["priceSpecification"] != null ||
      obj["name"] != null ||
      obj["category"] != null
    ) {
      list.push(obj);
    }
  };
  visit(offers);
  return list;
}

export function pricingFromStructured(html: string): StructuredPricing | null {
  const nodes = extractJsonLd(html);
  const products = [
    ...findByType(nodes, "Product"),
    ...findByType(nodes, "SoftwareApplication"),
    ...findByType(nodes, "Service"),
  ];
  const plans: StructuredPricingPlan[] = [];
  for (const product of products) {
    const productName = asText(product["name"]);
    const offers = offersOf(product);
    // The product name only stands in for a tier name when the product IS the tier
    // (a single offer). With several tiers it names the product, not a plan, so it
    // must not leak onto a nameless tier — see offerToPlan.
    const fallback = offers.length === 1 ? productName : null;
    for (const offer of offers) {
      const plan = offerToPlan(offer, fallback);
      if (plan) plans.push(plan);
    }
  }
  // Dedupe identical (name, price, period) tiers some sites emit twice.
  const seen = new Set<string>();
  const deduped = plans.filter((p) => {
    const k = `${p.plan_name}|${p.price}|${p.billing_period}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.length > 0 ? { plans: deduped } : null;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface StructuredJob {
  title: string;
  department: string;
  location: string | null;
}
export interface StructuredJobs {
  jobs: StructuredJob[];
}

const DEPARTMENT_RULES: [RegExp, string][] = [
  [/engineer|developer|software|backend|front[\s-]?end|full[\s-]?stack|devops|\bsre\b|infrastructure|platform|machine learning|\bml\b/i, "Engineering"],
  [/account exec|business development|\bbdr\b|\bsdr\b|\bae\b|\bsales\b/i, "Sales"],
  [/marketing|growth|\bseo\b|content|brand|demand gen|communications/i, "Marketing"],
  [/product manager|product owner|\bpm\b|product lead|head of product/i, "Product"],
  [/design|\bux\b|\bui\b|user research/i, "Design"],
  [/customer success|\bcsm\b|support engineer|technical support|onboarding specialist/i, "Customer Success"],
  [/operations|\bops\b|logistics|supply chain/i, "Operations"],
  [/finance|account(?:ant|ing)|controller|\bfp&a\b|treasury/i, "Finance"],
  [/recruit|people ops|\bhr\b|talent|human resources/i, "People"],
  [/data analyst|data scien|analytics|business intelligence|\bbi\b/i, "Data"],
];

/** Infer a normalized department from the title (deterministic, 0 AI). schema.org
 *  JobPosting has no consistent department field, so we mirror the AI taxonomy. */
function inferDepartment(title: string, posting: JsonLdNode): string {
  const explicit =
    asText(posting["occupationalCategory"]) ?? asText(posting["industry"]);
  const haystack = `${title} ${explicit ?? ""}`;
  for (const [re, dept] of DEPARTMENT_RULES) {
    if (re.test(haystack)) return dept;
  }
  return "Other";
}

function locationOf(posting: JsonLdNode): string | null {
  if (/telecommute/i.test(asText(posting["jobLocationType"]) ?? "")) return "Remote";
  const loc = posting["jobLocation"];
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first || typeof first !== "object") return null;
  const address = (first as JsonLdNode)["address"];
  const addr = (Array.isArray(address) ? address[0] : address) as JsonLdNode | undefined;
  if (!addr || typeof addr !== "object") return asText((first as JsonLdNode)["name"]);
  const parts = [
    asText(addr["addressLocality"]),
    asText(addr["addressRegion"]),
    asText(addr["addressCountry"]),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function jobsFromStructured(html: string): StructuredJobs | null {
  const postings = findByType(extractJsonLd(html), "JobPosting");
  if (postings.length === 0) return null;
  const jobs: StructuredJob[] = [];
  for (const p of postings) {
    const title = asText(p["title"]) ?? asText(p["name"]);
    if (!title) continue;
    jobs.push({ title, department: inferDepartment(title, p), location: locationOf(p) });
  }
  return jobs.length > 0 ? { jobs } : null;
}

// ── Reviews (numeric scores only — the qualitative summary stays generative) ────

export interface StructuredReviewScores {
  average_score: number | null;
  review_count: number | null;
}

function ratingFrom(node: JsonLdNode): StructuredReviewScores | null {
  const value = asPrice(node["ratingValue"]);
  if (value === null) return null;
  const best = asPrice(node["bestRating"]);
  // Normalize to a /5 scale when the site advertises a different ceiling.
  const average = best && best !== 5 ? Math.round((value / best) * 5 * 10) / 10 : value;
  const count = asPrice(node["reviewCount"]) ?? asPrice(node["ratingCount"]);
  return { average_score: average, review_count: count };
}

/**
 * Aggregate review scores from `AggregateRating` — either a standalone node or one
 * nested under a Product / SoftwareApplication `aggregateRating`. Covers only the
 * numeric part; praises/complaints are a generative summary handled by AI.
 */
export function reviewScoresFromStructured(html: string): StructuredReviewScores | null {
  const nodes = extractJsonLd(html);
  for (const node of findByType(nodes, "AggregateRating")) {
    const r = ratingFrom(node);
    if (r) return r;
  }
  for (const node of nodes) {
    const nested = node["aggregateRating"];
    const obj = (Array.isArray(nested) ? nested[0] : nested) as JsonLdNode | undefined;
    if (obj && typeof obj === "object") {
      const r = ratingFrom(obj);
      if (r) return r;
    }
  }
  return null;
}
